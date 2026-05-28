import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, FlatList, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, StyleSheet, ActivityIndicator,
  Image, Alert, Keyboard, Clipboard,
} from 'react-native';
import { useRoute, RouteProp, useNavigation } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { Q } from '@nozbe/watermelondb';
import { chatApi } from '../../api/chat.api';
import { Message, SystemRole, ClearanceLevel } from '../../types';
import { Colors } from '../../utils/theme';
import { fileUtils } from '../../utils/fileUtils';
import { getServerReachable, checkServerReachable } from '../../api/axios';
import { ScreenHeader } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { useSocket, emitWhenReady } from '../../hooks/useSocket';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';
import { database, collections, safeWrite } from '../../db/index';
import { MessageStatusIcon } from '../../components/MessageStatusIcon';
import { MediaViewer, VideoThumbnail } from '../../components/MediaViewer';
import { MessageContextMenu } from '../../components/MessageContextMenu';

type RouteParams = { ChatRoom: { chatId: string; chatName?: string } };

const STATIC_BASE = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000/api')
  .replace('/api', '');

type UploadAbortSignal = { aborted: boolean; settled?: boolean; onAbort?: () => void };

const isImageMime = (mimeType?: string | null) => !!mimeType?.startsWith('image/');
const isVideoMime = (mimeType?: string | null) => !!mimeType?.startsWith('video/');
const shouldUseCaption = (mimeType?: string | null) => isImageMime(mimeType) || isVideoMime(mimeType);

/** Дедуплікує масив повідомлень за id, зберігаючи перше входження */
const dedupMessagesById = (msgs: Message[]): Message[] => {
  const seen = new Set<string>();
  return msgs.filter(m => {
    if (seen.has(m.id)) {
      return false;
    }
    seen.add(m.id);
    return true;
  });
};

function AdaptiveImage({ uri }: { uri: string }) {
  const [size, setSize] = useState({ width: 220, height: 160 });
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
    Image.getSize(
      uri,
      (width, height) => {
        const maxWidth = 250;
        const maxHeight = 200;
        const ratio = width / height;

        let finalWidth = width;
        let finalHeight = height;

        if (width > maxWidth) {
          finalWidth = maxWidth;
          finalHeight = maxWidth / ratio;
        }
        if (finalHeight > maxHeight) {
          finalHeight = maxHeight;
          finalWidth = maxHeight * ratio;
        }

        setSize({ width: finalWidth, height: finalHeight });
      },
      () => {
        setFailed(true);
        setSize({ width: 220, height: 120 });
      },
    );
  }, [uri]);

  if (failed) {
    return (
      <View style={[styles.attachImage, styles.attachImageMissing, { width: size.width, height: size.height }]}>
        <Text style={styles.attachImageMissingText}>Зображення недоступне</Text>
      </View>
    );
  }

  return (
    <Image 
      source={{ uri }} 
      style={[styles.attachImage, { width: size.width, height: size.height }]} 
      resizeMode="cover" 
    />
  );
}

export default function ChatRoomScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<RouteParams, 'ChatRoom'>>();
  const { chatId, chatName } = route.params;
  const { user } = useAuth();

  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const [text, setText] = useState('');
  const [typing, setTyping] = useState<string | null>(null);
  const [uploadingCount, setUploadingCount] = useState(0);
  const [mediaViewerVisible, setMediaViewerVisible] = useState(false);
  const [selectedMedia, setSelectedMedia] = useState<{ url: string; type: 'image' | 'video' }>({ url: '', type: 'image' });
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [contextMenuVisible, setContextMenuVisible] = useState(false);
  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null);
  const [replyToMessage, setReplyToMessage] = useState<Message | null>(null);
  const [caption, setCaption] = useState('');
  const [showCaptionInput, setShowCaptionInput] = useState(false);
  const [pendingMedia, setPendingMedia] = useState<{uri: string, name: string, type: string} | null>(null);
  const TAB_BAR_HEIGHT = 65; 
  const flatRef = useRef<FlatList>(null);
  const typingTimer = useRef<any>(null);
  const lastTextSendRef = useRef<{ content: string; at: number } | null>(null);

  const { sendMessage, sendTyping } = useSocket({
    onNewMessage: (msg) => {
      if (msg.chatId !== chatId) return;
      
      const newMsg = {
        ...msg,
        sentAt: typeof msg.sentAt === 'string' ? msg.sentAt : new Date(msg.sentAt).toISOString(),
      } as Message;

      let replacedTemp = false;

      setMessages((prev) => {
        // Try to match temp message: first by content+senderId, then by attachmentUrl+senderId
        const tempIndex = prev.findIndex(m => 
          m?.id?.startsWith('temp-') && 
          m.senderId === newMsg.senderId &&
          (
            (m.content === newMsg.content) ||
            (newMsg.attachmentUrl && m.attachmentUrl && m.attachmentUrl === newMsg.attachmentUrl) ||
            (newMsg.attachmentUrl && !m.attachmentUrl && m.content === (newMsg as any).attachmentUrl)
          )
        );

        if (tempIndex !== -1) {
          const updated = [...prev];
          const oldTemp = updated[tempIndex];
          updated[tempIndex] = { ...newMsg, replyTo: oldTemp.replyTo };
          replacedTemp = true;
          return dedupMessagesById(updated);
        }

        if (prev.find((m) => m.id === newMsg.id)) return prev;

        if (newMsg.replyToId) {
          newMsg.replyTo = prev.find(m => m.id === newMsg.replyToId);
        }

        return dedupMessagesById([newMsg, ...prev]);
      });

      // Зберігаємо повідомлення в локальну БД, щоб воно не зникло після перезаходу
      saveMessagesToDB([newMsg]).catch((err) =>
        console.warn('[ChatRoom] saveMessagesToDB on WS new_message failed:', err)
      );

      // Якщо було замінено temp-повідомлення — оновити pending запис в БД (serverId)
      if (replacedTemp) {
        (async () => {
          try {
            const { Q } = await import('@nozbe/watermelondb');
            const existing = await collections.chatMessages
              .query(Q.where('chat_id', chatId), Q.where('pending_action', 'send'))
              .fetch();
            const tempMatch = (existing as any[]).find(
              (m: any) => !(m as any).serverId && m.content === newMsg.content && m.senderId === newMsg.senderId
            );
            if (tempMatch) {
              await safeWrite(async () => {
                await tempMatch.update((m: any) => {
                  (m as any).serverId = msg.id;
                  (m as any).isSynced = true;
                  (m as any).pendingAction = null;
                  (m as any).messageStatus = msg.messageStatus || 'sent';
                  (m as any).lastSyncedAt = Date.now();
                });
              });
            }
          } catch (err) {
            console.warn('[ChatRoom] update pending message failed:', err);
          }
        })();
      }
    },
    onMessagesRead: (data) => {
      if (data.chatId !== chatId) return;
      setMessages(prev => prev.map(m => {
        if (data.messageIds.includes(m.id)) {
          return {
            ...m,
            messageStatus: 'read',
            readBy: [...(m.readBy || []), data.readerId]
          };
        }
        return m;
      }));
    },
    onTyping: (data) => {
      if (data.userId !== user?.id) {
        setTyping(data.isTyping ? data.name : null);
        if (data.isTyping) {
          clearTimeout(typingTimer.current);
          typingTimer.current = setTimeout(() => setTyping(null), 3000);
        }
      }
    },
  });

  const { isOnline } = useNetworkStatus();
  const isOnlineRef = useRef(isOnline);
  useEffect(() => { isOnlineRef.current = isOnline; }, [isOnline]);

  const isLoadingRef = useRef(false);

  const cleanupDuplicateLocalMessages = useCallback(async (localMessages?: any[]) => {
    try {
      const rows = localMessages ?? await collections.chatMessages
        .query(Q.where('chat_id', chatId), Q.sortBy('sent_at', Q.desc))
        .fetch();
      const seen = new Map<string, any>();
      const duplicates: any[] = [];

      for (const row of rows as any[]) {
        const key = row.serverId || row.id;
        const existing = seen.get(key);
        if (!existing) {
          seen.set(key, row);
          continue;
        }

        const keepExisting = !!existing.serverId || existing.isSynced || existing.sentAt >= row.sentAt;
        if (keepExisting) {
          duplicates.push(row);
        } else {
          duplicates.push(existing);
          seen.set(key, row);
        }
      }

      if (!duplicates.length) return;
      await safeWrite(async () => {
        await database.batch(...duplicates.map((m) => m.prepareDestroyPermanently()));
      });
      console.log(`[ChatRoom] cleaned ${duplicates.length} duplicate local message(s)`);
    } catch (err) {
      console.warn('[ChatRoom] duplicate cleanup failed:', err);
    }
  }, [chatId]);

  const saveMessagesToDB = useCallback(async (msgs: Message[]) => {
    if (!msgs.length) return;
    try {
      const existing = await collections.chatMessages
        .query(Q.where('chat_id', chatId))
        .fetch();
      
      const operations: any[] = [];
      
      for (const msg of msgs) {
        const existingByServerId = existing.filter((m: any) => m.serverId === msg.id);
        const primaryByServerId = existingByServerId[0];
        for (const dup of existingByServerId.slice(1)) {
          operations.push(dup.prepareDestroyPermanently());
        }
        if (primaryByServerId) {
          // Don't overwrite pending (unsynced) messages — keep their local state
          if (!(primaryByServerId as any).pendingAction) {
            operations.push(
              primaryByServerId.prepareUpdate((m: any) => {
                m.messageStatus = (msg as any).messageStatus || 'sent';
                m.readByRaw = JSON.stringify((msg as any).readBy || []);
                m.deliveredToRaw = JSON.stringify((msg as any).deliveredTo || []);
                m.lastSyncedAt = Date.now();
              })
            );
          }
          continue;
        }

        // Check for existing record with same content+senderId+sentAt OR same attachmentUrl+senderId
        const dupByContent = existing.find((m: any) => {
          if ((m as any).serverId === msg.id) return false;
          const msgTime = typeof msg.sentAt === 'string' ? new Date(msg.sentAt).getTime() : msg.sentAt;
          // Same content+senderId within 30s window
          if (m.content === msg.content && m.senderId === msg.senderId && Math.abs(m.sentAt - msgTime) < 30000) return true;
          // Same attachmentUrl (for attachment messages)
          const msgUrl = (msg as any).attachmentUrl;
          const mUrl = (m as any).attachmentUrl;
          if (msgUrl && mUrl && mUrl === msgUrl && m.senderId === msg.senderId) return true;
          return false;
        });
        if (dupByContent) {
          if (!(dupByContent as any).serverId) {
            operations.push(
              dupByContent.prepareUpdate((m: any) => {
                m.serverId = msg.id;
                m.isSynced = true;
                m.pendingAction = null;
                m.lastSyncedAt = Date.now();
              })
            );
          }
          continue;
        }

        const tempMatch = existing.find((m: any) => {
          if (!m?.id?.startsWith('temp-')) return false;
          if (m.content !== msg.content) return false;
          if (m.senderId !== msg.senderId) return false;
          const tempTime = m.sentAt;
          const serverTime = typeof msg.sentAt === 'string' ? new Date(msg.sentAt).getTime() : msg.sentAt;
          return Math.abs(tempTime - serverTime) < 30000;
        });

        if (tempMatch) {
          operations.push(
            tempMatch.prepareUpdate((m: any) => {
              m.serverId = msg.id;
              m.isSynced = true;
              m.pendingAction = null;
              m.messageStatus = (msg as any).messageStatus || 'sent';
              m.readByRaw = JSON.stringify((msg as any).readBy || []);
              m.deliveredToRaw = JSON.stringify((msg as any).deliveredTo || []);
              m.lastSyncedAt = Date.now();
            })
          );
        } else {
          operations.push(
            collections.chatMessages.prepareCreate((m: any) => {
              m.serverId = msg.id;
              m.chatId = msg.chatId;
              m.senderId = msg.senderId;
              m.senderName = msg.sender?.fullName || null;
              m.content = msg.content;
              m.sentAt = typeof msg.sentAt === 'string' ? new Date(msg.sentAt).getTime() : msg.sentAt;
              m.isSynced = true;
              m.pendingAction = null;
              m.messageType = (msg as any).messageType || 'text';
              m.attachmentUrl = (msg as any).attachmentUrl || null;
              m.messageStatus = (msg as any).messageStatus || 'sent';
              m.readByRaw = JSON.stringify((msg as any).readBy || []);
              m.deliveredToRaw = JSON.stringify((msg as any).deliveredTo || []);
              m.replyToId = msg.replyToId || null;
              m.lastSyncedAt = Date.now();
            })
          );
        }
      }

      if (operations.length > 0) {
        await safeWrite(async () => {
          await database.batch(...operations);
        });
      }
    } catch (err) {
      console.warn('[ChatRoomScreen] Помилка збереження в БД:', err);
    }
  }, [chatId]);

  const mapLocalToMessage = (m: any): Message => {
    const sentAtStr = typeof m.sentAt === 'number' 
      ? new Date(m.sentAt).toISOString() 
      : (m.sentAt || new Date().toISOString());
    return {
      id: m.serverId || m.id,
      chatId: m.chatId,
      senderId: m.senderId,
      content: m.content,
      sentAt: sentAtStr,
      messageType: (m.messageType === 'attachment' || m.messageType === 'system' ? m.messageType : 'text') as any,
      attachmentUrl: m.attachmentUrl || undefined,
      messageStatus: m.messageStatus || 'sent',
      readBy: m.readBy || [],
      deliveredTo: m.deliveredTo || [],
      replyToId: m.replyToId || undefined,
      replyTo: undefined,
      sender: {
        id: m.senderId,
        fullName: m.senderName || 'Користувач',
        email: '',
        systemRole: SystemRole.VOLUNTEER,
        clearanceLevel: ClearanceLevel.LOCAL,
        trustScore: 0,
        isBlocked: false,
        createdAt: new Date().toISOString(),
      },
    } as Message;
  };

  const load = useCallback(async () => {
    if (!chatId || isLoadingRef.current) return;
    isLoadingRef.current = true;
    setLoading(true);
    
    try {
      const localMessages = await collections.chatMessages
        .query(Q.where('chat_id', chatId), Q.sortBy('sent_at', Q.desc))
        .fetch();
      cleanupDuplicateLocalMessages(localMessages);
      
      const mapped = dedupMessagesById(localMessages.map(mapLocalToMessage));

      mapped.forEach(m => {
        if (m.replyToId) {
          m.replyTo = mapped.find(prev => prev.id === m.replyToId);
        }
      });

      setMessages(mapped);
      setLoading(false);

      if (isOnlineRef.current && await checkServerReachable()) {
        try {
          const data = await chatApi.getLatestMessages(chatId, 50);
          if (data && data.length > 0) {
            await saveMessagesToDB(data);
            
            const updatedLocal = await collections.chatMessages
              .query(Q.where('chat_id', chatId), Q.sortBy('sent_at', Q.desc))
              .fetch();
            cleanupDuplicateLocalMessages(updatedLocal);
            const remapped = dedupMessagesById(updatedLocal.map(mapLocalToMessage));
            remapped.forEach(m => {
              if (m.replyToId) m.replyTo = remapped.find(prev => prev.id === m.replyToId);
            });
            setMessages(remapped);
            setHasMore(remapped.length >= 50);
            
            chatApi.markAsRead(chatId).catch(() => {});
          }
        } catch (apiErr: any) {
          if (apiErr.response?.status === 403) {
            Alert.alert('Доступ обмежено', 'Ви більше не маєте доступу до цього чату.');
            navigation.goBack();
            const toDelete = await collections.chatMessages.query(Q.where('chat_id', chatId)).fetch();
            await safeWrite(() => Promise.all(toDelete.map(m => m.destroyPermanently())));
          }
        }
      }
    } catch (error: any) {
      console.warn('[ChatRoomScreen] Load error:', error);
    } finally {
      setLoading(false);
      isLoadingRef.current = false;
    }
  }, [chatId, saveMessagesToDB, navigation, cleanupDuplicateLocalMessages]);

  useEffect(() => {
    load();
    return () => {
      if (typingTimer.current) clearTimeout(typingTimer.current);
    };
  }, [load]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || messages.length === 0) return;
    setLoadingMore(true);
    try {
      const oldestMsg = messages[messages.length - 1];
      const older = await chatApi.getMessages(chatId, 25, oldestMsg.id, 'DESC');
      if (older.length > 0) {
        setMessages(prev => {
          const uniqueNew = older.filter(o => !prev.some(p => p.id === o.id));
          return [...prev, ...uniqueNew];
        });
        setHasMore(older.length >= 25);
      } else {
        setHasMore(false);
      }
    } catch (e) {
      console.warn('[loadMore] error:', e);
    } finally {
      setLoadingMore(false);
    }
  }, [chatId, messages, loadingMore, hasMore]);

  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', (e) => {
      setKeyboardHeight(e.endCoordinates.height);
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardHeight(0);
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  const handleSend = async () => {
    const content = text.trim();
    if (!content) return;
    const nowMs = Date.now();
    const lastSend = lastTextSendRef.current;
    if (lastSend?.content === content && nowMs - lastSend.at < 800) return;
    lastTextSendRef.current = { content, at: nowMs };
    const repId = replyToMessage?.id;
    const now = new Date().toISOString();
    setText('');
    const prevReply = replyToMessage;
    setReplyToMessage(null);
    sendTyping(chatId, false);

    const tempMsg: Message = {
      id: `temp-${Date.now()}`,
      chatId,
      senderId: user?.id || '',
      content,
      sentAt: now,
      readBy: [],
      messageType: 'text',
      messageStatus: 'pending',
      sender: user as any,
      replyToId: repId,
      replyTo: prevReply || undefined,
    };
    
    setMessages(prev => [tempMsg, ...prev]);

    try {
      if (await checkServerReachable()) {
        const sent = await chatApi.sendMessage(chatId, content, repId);
        const sentMsg = {
          ...sent,
          sentAt: typeof sent.sentAt === 'string' ? sent.sentAt : new Date(sent.sentAt).toISOString(),
          replyTo: prevReply || (sent as any).replyTo,
        } as Message;
        setMessages(prev => prev.map(m => m.id === tempMsg.id ? sentMsg : m));
        await saveMessagesToDB([sentMsg]);
      } else {
        const { SyncService } = await import('../../db/SyncService');
        await SyncService.saveMessageOffline({
          chatId,
          senderId: user?.id || '',
          senderName: user?.fullName,
          content,
          replyToId: repId,
        });
      }
    } catch (err: any) {
      if (!getServerReachable() || String(err?.message || err).includes('Network request failed')) {
        const { SyncService } = await import('../../db/SyncService');
        await SyncService.saveMessageOffline({
          chatId,
          senderId: user?.id || '',
          senderName: user?.fullName,
          content,
          replyToId: repId,
        });
        setMessages(prev => prev.map(m => m.id === tempMsg.id ? { ...m, messageStatus: 'pending' } : m));
      } else {
        setMessages(prev => prev.map(m => m.id === tempMsg.id ? { ...m, messageStatus: 'failed' } : m));
        Alert.alert('Помилка', 'Не вдалося відправити повідомлення');
      }
    }
  };

  const handleCopyMessage = () => {
    if (selectedMessage) {
      Clipboard.setString(selectedMessage.content);
      Alert.alert('✅', 'Повідомлення скопійовано');
      setContextMenuVisible(false);
    }
  };

  const handleDeleteMessage = async () => {
    if (!selectedMessage) return;
    Alert.alert('Видалити повідомлення', 'Ви впевнені?', [
      { text: 'Скасувати', style: 'cancel' },
      {
        text: 'Видалити',
        style: 'destructive',
        onPress: async () => {
          try {
            await chatApi.deleteMessage(chatId, selectedMessage.id);
            setMessages(prev => prev.filter(m => m.id !== selectedMessage.id));
            setContextMenuVisible(false);
          } catch (error: any) {
            Alert.alert('Помилка', 'Не вдалося видалити: ' + error.message);
          }
        }
      }
    ]);
  };

  const handleDownloadMessage = async () => {
    if (!selectedMessage) return;
    setContextMenuVisible(false);
    const msg = selectedMessage;
    const attachUrl = msg.attachmentUrl;
    if (!attachUrl) return;
    const filename = attachUrl.split('/').pop() || 'file';
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    const mimeByExt: Record<string, string> = {
      jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
      gif: 'image/gif', webp: 'image/webp', pdf: 'application/pdf',
      doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      mp4: 'video/mp4',
    };
    const mimeType = mimeByExt[ext] || 'application/octet-stream';
    await fileUtils.downloadAndOpenFile(attachUrl, filename, mimeType);
  };

  const selectedMessageHasAttachment = selectedMessage?.attachmentUrl != null;

  const handleReplyMessage = () => {
    if (selectedMessage) {
      setReplyToMessage(selectedMessage);
      setContextMenuVisible(false);
    }
  };

  const handleForwardMessage = () => {
    if (selectedMessage) {
      setContextMenuVisible(false);
      Alert.alert('Незабаром', 'Функція пересилання в розробці');
    }
  };

  const handleTyping = (val: string) => {
    setText(val);
    sendTyping(chatId, val.length > 0);
  };

  const savePendingAttachment = async (uri: string, name: string, type: string, captionText = '') => {
    const now = new Date().toISOString();
    const messageContent = shouldUseCaption(type) ? captionText : (captionText || name);
    const tempMsg: Message = {
      id: `temp-${Date.now()}`,
      chatId,
      senderId: user?.id || '',
      content: messageContent,
      sentAt: now,
      readBy: [],
      messageType: 'attachment' as any,
      attachmentUrl: uri,
      messageStatus: 'pending',
      sender: user as any,
      replyToId: replyToMessage?.id,
      replyTo: replyToMessage || undefined,
    };

    setMessages(prev => [tempMsg, ...prev]);
    setReplyToMessage(null);

    const { SyncService } = await import('../../db/SyncService');
    await SyncService.saveMessageOffline({
      chatId,
      senderId: user?.id || '',
      senderName: user?.fullName,
      content: messageContent,
      messageType: 'attachment',
      attachmentUrl: uri,
      mimeType: type,
      replyToId: tempMsg.replyToId,
    });
  };

  // Зберігає refs для скасування завантажень
  const abortUploadsRef = useRef<Map<string, UploadAbortSignal>>(new Map());

  const uploadAndSend = async (uri: string, name: string, type: string, caption = '', reply?: Message | null) => {
    setUploadingCount(c => c + 1);

    // Логуємо розмір файлу для діагностики швидкості
    // Створюємо temp-повідомлення ОДРАЗУ, щоб показати прев'ю
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
    const now = new Date().toISOString();
    const tempContent = shouldUseCaption(type) ? caption : (caption || name);
    const tempMsg: Message = {
      id: tempId,
      chatId,
      senderId: user?.id || '',
      content: tempContent,
      sentAt: now,
      readBy: [],
      messageType: 'attachment' as any,
      attachmentUrl: uri,
      messageStatus: 'sending', // показуємо як "завантажується"
      sender: user as any,
      replyToId: reply?.id,
      replyTo: reply || undefined,
    } as Message;
    (tempMsg as any).uploadProgress = 0;
    (tempMsg as any).fileName = name;
    (tempMsg as any).mimeType = type;
    setMessages(prev => [tempMsg, ...prev]);

    // Створюємо abort сигнал для можливості скасування
    const abortSignal: UploadAbortSignal = { aborted: false };
    abortUploadsRef.current.set(tempId, abortSignal);

    try {
      if (!await checkServerReachable()) {
        await syncOfflineAttachment(uri, name, type, tempId, caption, reply?.id);
        setMessages(prev => prev.map(m => m.id === tempId ? { ...m, messageStatus: 'pending' } : m));
        return;
      }

      // Оновлюємо прогрес в temp-повідомленні
      const result = await chatApi.sendFile(
        chatId,
        { uri, name, type },
        (progress) => {
          setMessages(prev => prev.map(m =>
            m.id === tempId
              ? { ...m, messageStatus: 'sending', ...({ uploadProgress: progress } as any) }
              : m
          ));
        },
        abortSignal,
      );

      if (abortSignal.aborted) {
        return;
      }

      // Не блокуємо UI — відправляємо fire-and-forget
      const messageContent = shouldUseCaption(type) ? caption : (caption || result.name);
      chatApi.sendMessage(chatId, messageContent, reply?.id, result.url)
        .then(async (sent) => {
          if (abortSignal.aborted) return;
          const sentMsg = {
            ...sent,
            sentAt: typeof sent.sentAt === 'string' ? sent.sentAt : new Date(sent.sentAt).toISOString(),
            replyTo: reply || (sent as any).replyTo,
          } as Message;
          setMessages(prev => dedupMessagesById(prev.map(m => m.id === tempId ? sentMsg : m)));
          abortSignal.settled = true;
          abortUploadsRef.current.delete(tempId);
          await saveMessagesToDB([sentMsg]);
        })
        .catch((sendErr: any) => {
          if (abortSignal.aborted) return;
          console.warn('[uploadAndSend] sendMessage after upload failed:', sendErr);
          if (!getServerReachable() || String(sendErr?.message || sendErr).includes('Network request failed')) {
            syncOfflineAttachment(result.url, result.name, type, tempId + '-retry', caption, reply?.id);
          }
          setMessages(prev => prev.map(m => m.id === tempId ? { ...m, messageStatus: 'failed' } : m));
          abortUploadsRef.current.delete(tempId);
          abortSignal.settled = true;
        });

      // Відправляємо повідомлення через API з attachmentUrl
      /*
      await chatApi.sendMessage(chatId, result.name, undefined, result.url).then(() => {
        // Оновлюємо список повідомлень через API
      }).catch((sendErr) => {
        console.warn('[uploadAndSend] sendMessage after upload failed:', sendErr);
        // Якщо не вдалося — зберігаємо офлайн
        syncOfflineAttachment(result.url, result.name, type, tempId + '-retry');
      });
      */
    } catch (e: any) {
      // Видаляємо temp-повідомлення при помилці
      abortUploadsRef.current.delete(tempId);

      if (e?.message === 'Upload cancelled') {
        setMessages(prev => prev.filter(m => m.id !== tempId));
        // Користувач скасував — нічого не робимо
        return;
      }
      if (!getServerReachable() || String(e?.message || e).includes('Network request failed')) {
        await syncOfflineAttachment(uri, name, type, tempId, caption, reply?.id);
        setMessages(prev => prev.map(m => m.id === tempId ? { ...m, messageStatus: 'pending' } : m));
        Alert.alert('Офлайн', 'Файл додано в чергу і буде відправлено після відновлення звʼязку');
        return;
      }
      Alert.alert('Помилка', 'Не вдалося відправити файл: ' + (e.message || e));
    } finally {
      setUploadingCount(c => Math.max(0, c - 1));
    }
  };

  // Збереження для офлайн синхронізації
  const syncOfflineAttachment = async (uri: string, name: string, type: string, msgId: string, captionText = '', replyToId?: string) => {
    // Якщо є temp-повідомлення в БД — оновлюємо його замість створення дубля
    try {
      const localMsgs = await collections.chatMessages.query(
        Q.where('chat_id', chatId)
      ).fetch();
      const existingTemp = (localMsgs as any[]).find((m: any) => m.id === msgId || m.serverId === msgId);
      if (existingTemp) {
        await safeWrite(async () => {
          await existingTemp.update((m: any) => {
            m.pendingAction = null;
            m.messageStatus = 'pending';
            m.content = shouldUseCaption(type) ? captionText : (captionText || name);
          });
        });
        return;
      }
    } catch (_) { /* fallback до SyncService */ }

    // Якщо temp не знайдено — створюємо новий offline запис
    const { SyncService } = await import('../../db/SyncService');
    await SyncService.saveMessageOffline({
      chatId,
      senderId: user?.id || '',
      senderName: user?.fullName,
      content: shouldUseCaption(type) ? captionText : (captionText || name),
      messageType: 'attachment',
      attachmentUrl: uri,
      mimeType: type,
      replyToId: replyToId || undefined,
    }).catch((err: any) => console.warn('[syncOfflineAttachment] error:', err));
  };

  /** Скасувати завантаження за tempId */
  const cancelUpload = (tempId: string) => {
    const signal = abortUploadsRef.current.get(tempId);
    if (signal && !signal.aborted) {
      signal.aborted = true;
      if (signal.onAbort) signal.onAbort();
      setMessages(prev => prev.filter(m => m.id !== tempId));
      abortUploadsRef.current.delete(tempId);
      return;
    }

    setMessages(prev => prev.filter(m => m.id !== tempId));
  };

  /** Показати діалог для введення підпису до медіа */
  const openCaptionDialog = (uri: string, name: string, type: string) => {
    setPendingMedia({ uri, name, type });
    setCaption('');
    setShowCaptionInput(true);
  };

  /** Підтвердити відправку медіа з підписом */
  const confirmSendWithCaption = () => {
    if (!pendingMedia) return;
    uploadAndSend(pendingMedia.uri, pendingMedia.name, pendingMedia.type, caption, replyToMessage);
    setShowCaptionInput(false);
    setPendingMedia(null);
    setCaption('');
  };

  const handlePickMedia = async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Потрібен дозвіл', 'Дозвольте доступ до галереї');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images', 'videos'] as any,
        allowsMultipleSelection: false,
      });
      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0];
      const fileName = asset.fileName || asset.uri.split('/').pop() || `media_${Date.now()}`;
      const normalized = await fileUtils.normalizeImagePickerAsset(asset.uri, fileName, asset.mimeType);
      // Показуємо діалог для введення підпису (для image/video)
      openCaptionDialog(normalized.uri, normalized.name, normalized.mimeType);
    } catch (err: any) {
      Alert.alert('Помилка', 'Не вдалося відкрити галерею: ' + err.message);
    }
  };

  const handlePickDocument = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0];
      // Нормалізуємо URI документа (Android content:// → file://) перед відправкою
      const normalized = await fileUtils.normalizeFileUri(asset.uri, asset.name, asset.mimeType);
      // Для документів caption не показуємо — відправляємо одразу з reply
      uploadAndSend(normalized.uri, normalized.name, normalized.mimeType, '', replyToMessage);
    } catch {
      Alert.alert('Помилка', 'Не вдалося відкрити документ');
    }
  };

  if (loading && messages.length === 0) {
    return (
      <View style={{ flex: 1, backgroundColor: Colors.background }}>
        <ScreenHeader title={chatName ?? 'Чат'} onBack={() => navigation.navigate('ChatsList')} />
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator color={Colors.primary} />
        </View>
      </View>
    );
  }

  const renderContent = () => (
    <View style={{ flex: 1 }}>
      <FlatList
        ref={flatRef}
        data={messages}
        keyExtractor={(m) => {
          const base = m.id || `msg_${m.sentAt}_${m.senderId}`;
          // Гарантуємо унікальність: якщо id починається з temp- — додаємо random suffix
          return base.startsWith('temp-') ? `${base}_${Math.random().toString(36).slice(2, 7)}` : base;
        }}
        inverted={true}
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        onScroll={(e) => {
          const offset = e.nativeEvent.contentOffset.y;
          setShowScrollToBottom(offset > 600);
        }}
        contentContainerStyle={{ padding: 12, paddingBottom: 4 }}
        ListEmptyComponent={
          !loading ? (
            <View style={{ alignItems: 'center', padding: 40 }}>
              <Text style={{ fontSize: 40, marginBottom: 12 }}>💬</Text>
              <Text style={{ color: Colors.textSecondary }}>Повідомлень поки немає</Text>
            </View>
          ) : null
        }
        renderItem={({ item: msg }) => (
          <MessageBubble
            message={msg}
            isMine={msg.senderId === user?.id}
            staticBase={STATIC_BASE}
            onReplyPress={(replyId) => {
              const targetIndex = messages.findIndex(m => m.id === replyId);
              if (targetIndex !== -1) {
                flatRef.current?.scrollToIndex({ index: targetIndex, animated: true });
              }
            }}
            onAvatarPress={(userId) => navigation.navigate('UserProfile', { userId })}
            onMediaPress={(url, type = 'image') => {
              if (type === 'document') {
                // Відкриваємо документи системним діалогом (як Telegram)
                const filename = url.split('/').pop() || 'file';
                const ext = filename.split('.').pop()?.toLowerCase() || '';
                const mimeByExt: Record<string, string> = {
                  pdf: 'application/pdf', doc: 'application/msword',
                  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                  xls: 'application/vnd.ms-excel',
                  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                  txt: 'text/plain', zip: 'application/zip',
                };
                fileUtils.openWithSystemApp(url, filename, mimeByExt[ext] || 'application/octet-stream');
                return;
              }
              setSelectedMedia({ url, type: type as 'image' | 'video' });
              setMediaViewerVisible(true);
            }}
            onLongPress={(message: Message) => {
              if (message.messageStatus === 'sending') {
                cancelUpload(message.id);
                return;
              }
              setSelectedMessage(message);
              setContextMenuVisible(true);
            }}
            onCancelUpload={(tempId) => cancelUpload(tempId)}
          />
        )}
      />

      {showScrollToBottom && (
        <TouchableOpacity 
          style={styles.scrollToBottom} 
          onPress={() => flatRef.current?.scrollToOffset({ offset: 0, animated: true })}
          activeOpacity={0.9}
        >
          <Text style={{ color: '#fff', fontSize: 18, fontWeight: '700' }}>▼</Text>
        </TouchableOpacity>
      )}

      <MessageContextMenu
        visible={contextMenuVisible}
        onClose={() => setContextMenuVisible(false)}
        onReply={handleReplyMessage}
        onForward={handleForwardMessage}
        onCopy={handleCopyMessage}
        onDelete={handleDeleteMessage}
        onDownload={handleDownloadMessage}
        showDownload={selectedMessageHasAttachment}
      />

      {replyToMessage && (
        <View style={styles.replyPreview}>
          <View style={{ borderLeftWidth: 3, borderLeftColor: Colors.primary, paddingLeft: 8 }}>
            <Text style={{ fontSize: 12, fontWeight: '700', color: Colors.primary }}>Відповідь</Text>
            <Text style={{ fontSize: 13, color: Colors.text }} numberOfLines={1}>{replyToMessage.content}</Text>
          </View>
          <TouchableOpacity onPress={() => setReplyToMessage(null)}>
            <Text style={{ fontSize: 18, color: Colors.textMuted }}>✕</Text>
          </TouchableOpacity>
        </View>
      )}
      <View style={[styles.inputRow, Platform.OS === 'android' && { paddingBottom: Math.max(10, keyboardHeight - TAB_BAR_HEIGHT) }]}>
        <TouchableOpacity style={styles.attachBtn} onPress={handlePickMedia}>
          <Text style={{ fontSize: 20 }}>🖼</Text>
          {uploadingCount > 0 && (
            <View style={{ position: 'absolute', top: -4, right: -4, backgroundColor: Colors.primary, borderRadius: 8, width: 16, height: 16, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>{uploadingCount}</Text>
            </View>
          )}
        </TouchableOpacity>
        <TouchableOpacity style={styles.attachBtn} onPress={handlePickDocument}>
          <Text style={{ fontSize: 20 }}>📎</Text>
        </TouchableOpacity>
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={handleTyping}
          placeholder="Написати повідомлення..."
          placeholderTextColor={Colors.textMuted}
          multiline
          maxLength={2000}
          returnKeyType="send"
          onSubmitEditing={handleSend}
        />
        <TouchableOpacity
            style={[styles.sendBtn, !text.trim() && styles.sendBtnDisabled]}
            onPress={handleSend}
            disabled={!text.trim()}
          >
            <Text style={{ fontSize: 20 }}>➤</Text>
          </TouchableOpacity>
      </View>

      {showCaptionInput && pendingMedia && (
        <View style={styles.captionOverlay}>
          <View style={styles.captionBox}>
            <Text style={{ fontWeight: '700', marginBottom: 8 }}>Додати підпис</Text>
            {isImageMime(pendingMedia.type) && (
              <Image source={{ uri: pendingMedia.uri }} style={{ width: 120, height: 120, borderRadius: 8, marginBottom: 8 }} />
            )}
            <TextInput
              style={styles.captionInput}
              value={caption}
              onChangeText={setCaption}
              placeholder="Введіть підпис..."
              placeholderTextColor={Colors.textMuted}
              autoFocus
              maxLength={500}
            />
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
              <TouchableOpacity
                style={[styles.captionBtn, { backgroundColor: Colors.borderLight }]}
                onPress={() => { setShowCaptionInput(false); setPendingMedia(null); }}
              >
                <Text>Скасувати</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.captionBtn, { backgroundColor: Colors.primary }]}
                onPress={confirmSendWithCaption}
              >
                <Text style={{ color: '#fff', fontWeight: '700' }}>Відправити</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: Colors.background }}>
      <ScreenHeader title={chatName ?? 'Чат'} onBack={() => navigation.navigate('ChatsList')} />
      {Platform.OS === 'ios' ? (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" keyboardVerticalOffset={90}>
          {renderContent()}
        </KeyboardAvoidingView>
      ) : (
        renderContent()
      )}
      <MediaViewer
        visible={mediaViewerVisible}
        url={selectedMedia.url}
        type={selectedMedia.type}
        onClose={() => setMediaViewerVisible(false)}
      />
    </View>
  );
}

const MessageBubble = React.memo(({
  message, isMine, staticBase, onAvatarPress, onMediaPress, onLongPress, onReplyPress, onCancelUpload,
}: {
  message: Message;
  isMine: boolean;
  staticBase: string;
  onAvatarPress?: (userId: string) => void;
  onMediaPress?: (url: string, type?: 'image' | 'video' | 'document') => void;
  onLongPress?: (message: Message) => void;
  onReplyPress?: (replyToId: string) => void;
  onCancelUpload?: (tempId: string) => void;
}) => {
  const isSystem = message.messageType === 'system';
  if (isSystem) {
    return (
      <View style={styles.systemMsg}>
        <Text style={styles.systemMsgText}>{message.content}</Text>
      </View>
    );
  }

  const time = new Date(message.sentAt).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
  const hasAttachment = !!message.attachmentUrl && typeof message.attachmentUrl === 'string' && message.attachmentUrl.length > 5;
  const attachUrl = hasAttachment
    ? /^(https?:|file:|content:|data:)/i.test(message.attachmentUrl as string)
      ? message.attachmentUrl
      : `${staticBase}${message.attachmentUrl}`
    : null;
  const isImage = attachUrl ? /\.(jpg|jpeg|png|gif|webp|bmp|heic)$/i.test(attachUrl) : false;
  const isVideo = attachUrl ? /\.(mp4|mov|avi|mkv|m4v)$/i.test(attachUrl) : false;

  return (
    <TouchableOpacity 
      onLongPress={() => onLongPress?.(message)}
      delayLongPress={500}
      activeOpacity={0.8}
      style={[styles.bubbleWrapper, isMine && styles.bubbleWrapperMine]}
    >
      {!isMine && (
        <TouchableOpacity
          style={styles.senderAvatar}
          onPress={(e) => {
            e.stopPropagation();
            message.senderId && onAvatarPress?.(message.senderId);
          }}
          activeOpacity={0.7}
        >
          <Text style={{ color: '#fff', fontWeight: '700', fontSize: 12 }}>
            {message.sender?.fullName?.[0] ?? '?'}
          </Text>
        </TouchableOpacity>
      )}
      <View style={[styles.bubble, isMine ? styles.bubbleMine : styles.bubbleOther]}>
        {!isMine && message.sender && (
          <Text style={styles.senderName}>{message.sender.fullName}</Text>
        )}
        {message.replyTo && (
          <TouchableOpacity 
            style={[styles.replyInBubble, isMine ? styles.replyInBubbleMine : styles.replyInBubbleOther]}
            onPress={() => message.replyToId && onReplyPress?.(message.replyToId)}
          >
            <Text style={[styles.replySender, isMine && { color: '#fff' }]} numberOfLines={1}>
              {message.replyTo.sender?.fullName || 'Користувач'}
            </Text>
            <Text style={[styles.replyText, isMine && { color: 'rgba(255,255,255,0.8)' }]} numberOfLines={2}>
              {message.replyTo.content}
            </Text>
          </TouchableOpacity>
        )}
        {isImage && attachUrl && (
          <TouchableOpacity onPress={(e) => {
            e.stopPropagation();
            onMediaPress?.(attachUrl);
          }}>
            <AdaptiveImage uri={attachUrl} />
          </TouchableOpacity>
        )}
        {!isImage && hasAttachment && attachUrl && isVideo && (
          <VideoThumbnail uri={attachUrl} onPress={() => {
            onMediaPress?.(attachUrl, 'video');
          }} />
        )}
        {!isImage && !isVideo && hasAttachment && attachUrl && (
          <View style={styles.attachFileRow}>
            <TouchableOpacity style={styles.attachFile} onPress={(e) => {
              e.stopPropagation();
              onMediaPress?.(attachUrl, 'document');
            }}>
              <Text style={styles.attachFileIcon}>📄</Text>
              <Text style={styles.attachFileName} numberOfLines={2}>{message.content}</Text>
            </TouchableOpacity>
          </View>
        )}
        {(message.content && (!hasAttachment || isImage || isVideo)) && (
          <Text style={[styles.bubbleText, isMine && styles.bubbleTextMine]}>{message.content}</Text>
        )}
        {(message as any).messageStatus === 'sending' && (
          <View style={styles.uploadProgressRow}>
            <ActivityIndicator size="small" color={isMine ? 'rgba(255,255,255,0.7)' : Colors.primary} />
            <Text style={[styles.uploadProgressText, isMine && styles.uploadProgressTextMine]}>
              {(message as any).uploadProgress > 0 ? `${(message as any).uploadProgress}%` : 'Завантаження...'}
            </Text>
            {onCancelUpload && (
              <TouchableOpacity
                style={styles.cancelUploadBtn}
                hitSlop={{ top: 12, right: 12, bottom: 12, left: 12 }}
                activeOpacity={0.7}
                onPressIn={(e) => e.stopPropagation()}
                onPress={(e) => { e.stopPropagation(); onCancelUpload(message.id); }}
              >
                <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700', lineHeight: 14 }}>✕</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
        <Text style={[styles.bubbleTime, isMine && { color: 'rgba(255,255,255,0.65)' }]}>{time}</Text>
        {isMine && (message.messageStatus || message.readBy || message.deliveredTo) && (
          <MessageStatusIcon
            status={(message.messageStatus || 'sent') as any}
            readBy={message.readBy || []}
            deliveredTo={message.deliveredTo || []}
          />
        )}
      </View>
    </TouchableOpacity>
  );
});

const styles = StyleSheet.create({
  replyPreview: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: 8, backgroundColor: Colors.surface, borderTopWidth: 1, borderTopColor: Colors.borderLight,
  },
  captionOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', zIndex: 100,
  },
  captionBox: {
    backgroundColor: Colors.surface, borderRadius: 16, padding: 20,
    width: '85%', alignItems: 'center',
  },
  captionInput: {
    width: '100%', borderWidth: 1, borderColor: Colors.border,
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10,
    fontSize: 15, backgroundColor: Colors.background, color: '#000000',
  },
  captionBtn: {
    flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center',
  },
  uploadProgressRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4,
  },
  uploadProgressText: {
    fontSize: 11, color: Colors.textMuted,
  },
  uploadProgressTextMine: {
    color: 'rgba(255,255,255,0.7)',
  },
  cancelUploadBtn: {
    marginLeft: 4,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(220,38,38,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 5,
    elevation: 5,
  },
  cancelUploadText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '800',
    lineHeight: 16,
  },
  inputRow: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 6,
    padding: 10, backgroundColor: Colors.surface,
    borderTopWidth: 1, borderTopColor: Colors.border,
  },
  attachBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20 },
  input: {
    flex: 1, borderWidth: 1.5, borderColor: Colors.border,
    borderRadius: 22, paddingHorizontal: 16, paddingVertical: 10,
    fontSize: 15, maxHeight: 120, backgroundColor: Colors.surface, color: '#000000',
  },
  sendBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  sendBtnDisabled: { backgroundColor: Colors.borderLight },
  bubbleWrapper: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: 8, gap: 6 },
  bubbleWrapperMine: { flexDirection: 'row-reverse' },
  senderAvatar: { width: 28, height: 28, borderRadius: 14, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  bubble: { maxWidth: '75%', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 8, overflow: 'hidden' },
  bubbleMine: { backgroundColor: Colors.primary, borderBottomRightRadius: 4 },
  bubbleOther: { backgroundColor: Colors.surface, borderBottomLeftRadius: 4, borderWidth: 1, borderColor: Colors.borderLight },
  senderName: { fontSize: 11, fontWeight: '700', color: Colors.primary, marginBottom: 3 },
  bubbleText: { fontSize: 15, color: Colors.text, lineHeight: 20 },
  bubbleTextMine: { color: '#fff' },
  bubbleTime: { fontSize: 10, color: Colors.textMuted, marginTop: 4, textAlign: 'right' },
  replyInBubble: {
    backgroundColor: 'rgba(0,0,0,0.05)',
    borderLeftWidth: 3,
    borderLeftColor: Colors.primary,
    padding: 6,
    borderRadius: 4,
    marginBottom: 6,
  },
  replyInBubbleMine: {
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderLeftColor: '#fff',
  },
  replyInBubbleOther: {
    backgroundColor: 'rgba(0,0,0,0.05)',
  },
  replySender: { fontSize: 11, fontWeight: '700', color: Colors.primary, marginBottom: 2 },
  replyText: { fontSize: 12, color: Colors.textSecondary },
  attachImage: { width: 220, height: 160, borderRadius: 10, marginBottom: 6 },
  attachImageMissing: {
    backgroundColor: 'rgba(0,0,0,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachImageMissingText: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  attachFile: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(0,0,0,0.07)', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, paddingRight: 36 },
  attachFileRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 6 },
  attachFileIcon: { fontSize: 24 },
  attachFileName: { flex: 1, fontSize: 13, color: Colors.text },
  attachDownloadBtn: { width: 28, height: 28, borderRadius: 14, backgroundColor: Colors.border, alignItems: 'center', justifyContent: 'center' },
  systemMsg: { alignSelf: 'center', backgroundColor: Colors.borderLight, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 6, marginBottom: 8 },
  systemMsgText: { fontSize: 12, color: Colors.textSecondary, textAlign: 'center' },
  scrollToBottom: {
    position: 'absolute', bottom: 100, right: 20, width: 44, height: 44,
    borderRadius: 22, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center',
    elevation: 5, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 3,
    zIndex: 10,
  },
});
