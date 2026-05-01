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
import { getServerReachable } from '../../api/axios';
import { ScreenHeader } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { useSocket, emitWhenReady } from '../../hooks/useSocket';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';
import { database, collections } from '../../db/index';
import { MessageStatusIcon } from '../../components/MessageStatusIcon';
import { NetworkStatusIndicator } from '../../components/NetworkStatusIndicator';
import { MediaViewer, VideoThumbnail } from '../../components/MediaViewer';
import { MessageContextMenu } from '../../components/MessageContextMenu';

type RouteParams = { ChatRoom: { chatId: string; chatName?: string } };

const STATIC_BASE = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000/api')
  .replace('/api', '');

// Допоміжний компонент для динамічного відображення фото
function AdaptiveImage({ uri }: { uri: string }) {
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    Image.getSize(uri, (width, height) => {
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
    });
  }, [uri]);

  if (size.width === 0) return <ActivityIndicator style={styles.attachImage} />;

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
  const [text, setText] = useState('');
  const [typing, setTyping] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [mediaViewerVisible, setMediaViewerVisible] = useState(false);
  const [selectedMedia, setSelectedMedia] = useState<{ url: string; type: 'image' | 'video' }>({ url: '', type: 'image' });
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [contextMenuVisible, setContextMenuVisible] = useState(false);
  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null);
  const [replyToMessage, setReplyToMessage] = useState<Message | null>(null);
  const [showForwardModal, setShowForwardModal] = useState(false);
  const [messageToForward, setMessageToForward] = useState<Message | null>(null);
  const TAB_BAR_HEIGHT = 65; // Приблизна висота вкладок
  const flatRef = useRef<FlatList>(null);
  const typingTimer = useRef<any>(null);
  const isNearBottomRef = useRef(true);

  const { sendMessage, sendTyping } = useSocket({
    onNewMessage: (msg) => {
      if (msg.chatId !== chatId) return;
      
      const newMsg = {
        ...msg,
        sentAt: typeof msg.sentAt === 'string' ? msg.sentAt : new Date(msg.sentAt).toISOString(),
      } as Message;

      setMessages((prev) => {
        // 1. Спробуємо знайти тимчасове повідомлення за контентом та автором
        const tempIndex = prev.findIndex(m => 
          m.id.startsWith('temp-') && 
          m.content === newMsg.content && 
          m.senderId === newMsg.senderId
        );

        if (tempIndex !== -1) {
          // Замінюємо тимчасове повідомлення серверним
          const updated = [...prev];
          updated[tempIndex] = { ...newMsg, replyTo: updated[tempIndex].replyTo };
          return updated;
        }

        // 2. Якщо це нове повідомлення
        if (prev.find((m) => m.id === newMsg.id)) return prev;
        return [...prev, newMsg];
      });
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

  const saveMessagesToDB = useCallback(async (msgs: Message[]) => {
    if (!msgs.length) return;
    try {
      const existing = await collections.chatMessages
        .query(Q.where('chat_id', chatId))
        .fetch();
      
      const operations: any[] = [];
      
      for (const msg of msgs) {
        // Check if we already have this message (by server ID)
        const existingByServerId = existing.find((m: any) => m.serverId === msg.id);
        if (existingByServerId) {
          // Update existing record (e.g., update messageStatus)
          operations.push(
            existingByServerId.prepareUpdate((m: any) => {
              m.messageStatus = (msg as any).messageStatus || 'sent';
              m.readByRaw = JSON.stringify((msg as any).readBy || []);
              m.deliveredToRaw = JSON.stringify((msg as any).deliveredTo || []);
              m.lastSyncedAt = Date.now();
            })
          );
          continue;
        }
        
        // Check if we have a temp message that matches (same content, sender, approximate time)
        const tempMatch = existing.find((m: any) => {
          if (!m.id.startsWith('temp-')) return false;
          if (m.content !== msg.content) return false;
          if (m.senderId !== msg.senderId) return false;
          // Match within 30 seconds
          const tempTime = m.sentAt;
          const serverTime = typeof msg.sentAt === 'string' ? new Date(msg.sentAt).getTime() : msg.sentAt;
          return Math.abs(tempTime - serverTime) < 30000;
        });
        
        if (tempMatch) {
          // Update temp message with server ID
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
          // Create new record
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
        await database.write(async () => {
          await database.batch(...operations);
        });
      }
    } catch (err) {
      console.warn('[ChatRoomScreen] Помилка збереження в БД:', err);
    }
  }, [chatId]);

  const load = useCallback(async () => {
    if (!chatId || isLoadingRef.current) return;
    isLoadingRef.current = true;
    setLoading(true);
    
    try {
      // Always load from local DB first
      const localMessages = await collections.chatMessages
        .query(Q.where('chat_id', chatId))
        .fetch();
      
      // Map local messages to Message type
      const mapped = localMessages.map((m: any) => {
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
          replyTo: undefined as Message | undefined,
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
      });

      // Build reply references
      mapped.forEach(m => {
        if (m.replyToId) {
          m.replyTo = mapped.find(prev => prev.id === m.replyToId);
        }
      });

      // If online, try to sync with server
      const serverReachable = getServerReachable();
      if (isOnlineRef.current && serverReachable) {
        try {
          const data = await chatApi.getLatestMessages(chatId, 50);
          if (data && data.length > 0) {
            // Save server messages to DB
            await saveMessagesToDB(data);
            
            // Mark read and update local state
            chatApi.markAsRead(chatId).then(() => {
              setMessages(prev => prev.map(m => 
                (m.senderId !== user?.id && m.messageStatus !== 'read') 
                  ? { ...m, messageStatus: 'read' } 
                  : m
              ));
            }).catch(() => {});
          }
        } catch (apiErr) {
          console.warn('[ChatRoomScreen] API sync failed:', apiErr);
        }
      }

      // Cleanup: Delete old messages (older than 30 days)
      try {
        const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
        const allMessages = await collections.chatMessages
          .query(Q.where('chat_id', chatId))
          .fetch();
        const toDelete = allMessages.filter((m: any) => {
          const msgTime = typeof m.sentAt === 'number' ? m.sentAt : new Date(m.sentAt).getTime();
          return msgTime < thirtyDaysAgo;
        });
        if (toDelete.length > 0) {
          await database.write(async () => {
            await Promise.all(toDelete.map((m: any) => m.markAsDeleted()));
          });
        }
      } catch (err) {
        console.warn('[ChatRoomScreen] Cleanup error:', err);
      }

      // Always re-load from DB after potential sync to get merged state
      const updatedLocal = await collections.chatMessages
        .query(Q.where('chat_id', chatId))
        .fetch();
      
      const remapped = updatedLocal.map((m: any) => {
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
          replyTo: undefined as Message | undefined,
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
      });

      // Build reply references
      remapped.forEach(m => {
        if (m.replyToId) {
          m.replyTo = remapped.find(prev => prev.id === m.replyToId);
        }
      });

      // Sort ASC (oldest first) - newest will be at bottom
      const sorted = remapped.sort((a, b) => 
        new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime()
      );
      
      setMessages(sorted);
      setHasMore(sorted.length >= 50);
    } catch (error: any) {
      console.warn('[ChatRoomScreen] Load error:', error);
    } finally {
      setLoading(false);
      isLoadingRef.current = false;
    }
  }, [chatId, saveMessagesToDB]);

  useEffect(() => {
    load();
    return () => {
      if (typingTimer.current) clearTimeout(typingTimer.current);
    };
  }, [load]);


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
    if (!content || sending) return;
    setSending(true);
    const repId = replyToMessage?.id;
    const now = new Date().toISOString(); // Use ISO string for consistency
    setText('');
    setReplyToMessage(null);
    sendTyping(chatId, false);
    
    const serverReachable = getServerReachable();
    if (serverReachable) {
      sendMessage(chatId, content, repId);
    }

    // Додаємо локально відразу для кращого UX - APPEND (ASC: newest at end = bottom)
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
      replyTo: replyToMessage || undefined,
    };
    // Append - with ASC sort, newest at end appears at bottom of FlatList
    setMessages(prev => [...prev, tempMsg]);

    import('../../db/SyncService')
      .then((module) =>
        module.SyncService.saveMessageOffline({
          chatId,
          senderId: user?.id || '',
          senderName: user?.fullName,
          content,
          replyToId: repId,
        })
      )
      .catch((err) => console.warn('[handleSend] saveOffline failed:', err));
    setSending(false);
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

  const handleReplyMessage = () => {
    if (selectedMessage) {
      setReplyToMessage(selectedMessage);
      setContextMenuVisible(false);
    }
  };

  const handleForwardMessage = () => {
    if (selectedMessage) {
      setMessageToForward(selectedMessage);
      setShowForwardModal(true);
      setContextMenuVisible(false);
    }
  };

  const handleTyping = (val: string) => {
    setText(val);
    sendTyping(chatId, val.length > 0);
  };

  const uploadAndSend = async (uri: string, name: string, type: string) => {
    setUploading(true);
    try {
      const result = await chatApi.sendFile(chatId, { uri, name, type });
      await emitWhenReady('send_message', { chatId, content: result.name, attachmentUrl: result.url });
    } catch (e: any) {
      Alert.alert('Помилка', 'Не вдалося відправити файл: ' + (e.message || e));
    } finally {
      setUploading(false);
    }
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
      await uploadAndSend(normalized.uri, normalized.name, normalized.mimeType);
    } catch (err: any) {
      Alert.alert('Помилка', 'Не вдалося відкрити галерею: ' + err.message);
    }
  };

  const handlePickDocument = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0];
      await uploadAndSend(asset.uri, asset.name, asset.mimeType ?? 'application/octet-stream');
    } catch {
      Alert.alert('Помилка', 'Не вдалося відкрити документ');
    }
  };

  if (loading) {
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
        keyExtractor={(m) => m.id}
        contentContainerStyle={{ padding: 12, paddingBottom: 4 }}
        ListEmptyComponent={
          <View style={{ alignItems: 'center', padding: 40 }}>
            <Text style={{ fontSize: 40, marginBottom: 12 }}>💬</Text>
            <Text style={{ color: Colors.textSecondary }}>Повідомлень поки немає</Text>
          </View>
        }
        renderItem={({ item: msg }) => (
          <MessageBubble
            message={msg}
            isMine={msg.senderId === user?.id}
            staticBase={STATIC_BASE}
            onReplyPress={(replyId) => {
              const target = messages.find(m => m.id === replyId);
              if (target) {
                // Scroll to target (optional logic)
              }
            }}
            onAvatarPress={(userId) => navigation.navigate('UserProfile', { userId })}
            onMediaPress={(url, type = 'image') => {
              setSelectedMedia({ url, type: type as 'image' | 'video' });
              setMediaViewerVisible(true);
            }}
            onLongPress={(message: Message) => {
              setSelectedMessage(message);
              setContextMenuVisible(true);
            }}
          />
        )}
        onEndReached={async () => {
          if (loadingMore || !hasMore || messages.length === 0) return;
          setLoadingMore(true);
          try {
            const oldest = messages[0];
            const data = await chatApi.getMessages(chatId, 50, oldest.id, 'DESC');
            if (data && data.length > 0) {
              await saveMessagesToDB(data);
              const remapped = data.map((m: any) => ({
                ...m,
                id: m.id,
                sentAt: typeof m.sentAt === 'string' ? m.sentAt : new Date(m.sentAt).toISOString(),
              }));
              setMessages(prev => [...remapped.reverse(), ...prev]);
            } else {
              setHasMore(false);
            }
          } catch (err) {
            console.warn('Load more error:', err);
          } finally {
            setLoadingMore(false);
          }
        }}
        onEndReachedThreshold={0.3}
        ListFooterComponent={loadingMore ? <ActivityIndicator /> : null}
        onScroll={(e) => {
          const { contentOffset } = e.nativeEvent;
          // With normal (non-inverted) FlatList, offset.y = 0 is the top (oldest messages).
          // If user scrolls down (to new messages), offset.y increases.
          const contentHeight = e.nativeEvent.contentSize.height;
          const layoutHeight = e.nativeEvent.layoutMeasurement.height;
          // Near bottom if we're within 100px of the bottom
          isNearBottomRef.current = (contentHeight - (contentOffset.y + layoutHeight)) < 100;
        }}
        scrollEventThrottle={100}
        onContentSizeChange={() => {
          // Scroll to bottom only if user was already near the bottom
          if (isNearBottomRef.current) {
            flatRef.current?.scrollToEnd({ animated: true });
          }
        }}
      />

      <MessageContextMenu
        visible={contextMenuVisible}
        onClose={() => setContextMenuVisible(false)}
        onReply={handleReplyMessage}
        onForward={handleForwardMessage}
        onCopy={handleCopyMessage}
        onDelete={handleDeleteMessage}
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
        <TouchableOpacity style={styles.attachBtn} onPress={handlePickMedia} disabled={uploading}>
          <Text style={{ fontSize: 20 }}>🖼</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.attachBtn} onPress={handlePickDocument} disabled={uploading}>
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
        {uploading ? (
          <ActivityIndicator color={Colors.primary} style={styles.sendBtn} />
        ) : (
          <TouchableOpacity
            style={[styles.sendBtn, !text.trim() && styles.sendBtnDisabled]}
            onPress={handleSend}
            disabled={!text.trim()}
          >
            <Text style={{ fontSize: 20 }}>➤</Text>
          </TouchableOpacity>
        )}
      </View>
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

function MessageBubble({
  message, isMine, staticBase, onAvatarPress, onMediaPress, onLongPress, onReplyPress,
}: {
  message: Message;
  isMine: boolean;
  staticBase: string;
  onAvatarPress?: (userId: string) => void;
  onMediaPress?: (url: string, type?: 'image' | 'video') => void;
  onLongPress?: (message: Message) => void;
  onReplyPress?: (replyToId: string) => void;
}) {
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
    ? message.attachmentUrl!.startsWith('http')
      ? message.attachmentUrl!
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
          <View style={styles.attachFile}>
            <Text style={styles.attachFileIcon}>📄</Text>
            <Text style={styles.attachFileName} numberOfLines={2}>{message.content}</Text>
          </View>
        )}
        {(message.content && (!hasAttachment || isImage || isVideo)) && (
          <Text style={[styles.bubbleText, isMine && styles.bubbleTextMine]}>{message.content}</Text>
        )}
        <Text style={[styles.bubbleTime, isMine && { color: 'rgba(255,255,255,0.65)' }]}>{time}</Text>
        {(message.messageStatus || message.readBy || message.deliveredTo) && (
          <MessageStatusIcon
            status={(message.messageStatus || 'sent') as any}
            readBy={message.readBy || []}
            deliveredTo={message.deliveredTo || []}
          />
        )}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  replyPreview: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: 8, backgroundColor: Colors.surface, borderTopWidth: 1, borderTopColor: Colors.borderLight,
  },
  typingBar: { paddingHorizontal: 16, paddingVertical: 4 },
  typingText: { fontSize: 12, color: Colors.textMuted, fontStyle: 'italic' },
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
  attachFile: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(0,0,0,0.07)', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, marginBottom: 6 },
  attachFileIcon: { fontSize: 24 },
  attachFileName: { flex: 1, fontSize: 13, color: Colors.text },
  systemMsg: { alignSelf: 'center', backgroundColor: Colors.borderLight, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 6, marginBottom: 8 },
  systemMsgText: { fontSize: 12, color: Colors.textSecondary, textAlign: 'center' },
});
