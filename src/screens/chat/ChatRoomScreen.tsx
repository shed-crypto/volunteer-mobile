import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, FlatList, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, StyleSheet, ActivityIndicator,
  Image, Alert,
} from 'react-native';
import { useRoute, RouteProp, useNavigation } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { chatApi } from '../../api/chat.api';
import { Message, SystemRole, ClearanceLevel } from '../../types';
import { Colors } from '../../utils/theme';
import { ScreenHeader } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { useSocket } from '../../hooks/useSocket';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';
import { collections } from '../../db';
import { SyncService } from '../../db/SyncService';

type RouteParams = { ChatRoom: { chatId: string; chatName?: string } };

// Базовий URL для статичних файлів (той самий що API, але без /api)
const STATIC_BASE = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000/api')
  .replace('/api', '');

export default function ChatRoomScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<RouteParams, 'ChatRoom'>>();
  const { chatId, chatName } = route.params;
  const { user } = useAuth();

  const [messages, setMessages]     = useState<Message[]>([]);
  const [loading, setLoading]       = useState(true);
  const [text, setText]             = useState('');
  const [typing, setTyping]         = useState<string | null>(null);
  const [sending, setSending]       = useState(false);
  const [uploading, setUploading]   = useState(false);
  const flatRef     = useRef<FlatList>(null);
  const typingTimer = useRef<any>(null);

  // ─── WebSocket ─────────────────────────────────────────────────────────────
  const { sendMessage, sendTyping } = useSocket({
    onNewMessage: (msg) => {
      if (msg.chatId === chatId) {
        setMessages((prev) => {
          if (prev.find((m) => m.id === msg.id)) return prev;
          return [...prev, msg as Message];
        });
        setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 100);
      }
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

  // ─── Load history ──────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    if (!chatId) { setLoading(false); return; }
    
    try {
      // First try to load from local database
      const localMessages = await collections.chatMessages.query().fetch();
      const filteredLocalMessages = localMessages
        .filter((m: any) => m.chatId === chatId)
        .map((m: any) => ({
          id: m.serverId || m.id,
          chatId: m.chatId,
          senderId: m.senderId,
          content: m.content,
          sentAt: m.sentAt,
          // Add other required fields with minimal User info
          messageType: 'text' as const,
          readBy: [],
          sender: {
            id: m.senderId,
            fullName: m.senderName || 'Користувач',
            email: '',
            systemRole: SystemRole.VOLUNTEER,
            clearanceLevel: ClearanceLevel.LOCAL,
            trustScore: 0,
            isBlocked: false,
            createdAt: new Date().toISOString()
          }
        }))
        .sort((a: any, b: any) => b.sentAt - a.sentAt)
        .slice(0, 50); // Limit to 50 most recent
      
      if (filteredLocalMessages.length > 0) {
        setMessages(filteredLocalMessages);
        setTimeout(() => flatRef.current?.scrollToEnd({ animated: false }), 100);
        setLoading(false);
        return;
      }
    } catch (localError) {
      console.log('Local DB lookup failed:', localError);
    }

    // If not found locally and we're online, try API
    if (isOnline) {
      try {
        const data = await chatApi.getMessages(chatId, 50);
        setMessages(data);
        // Save to local database for offline access
        try {
          await Promise.all(data.map(async (msg) => {
            // Check if message already exists
            try {
              await collections.chatMessages.find(msg.id);
            } catch {
              // Message doesn't exist, save it
              await collections.chatMessages.create((m: any) => {
                m.id = msg.id;
                m.serverId = msg.id;
                m.chatId = msg.chatId;
                m.senderId = msg.senderId;
                m.senderName = msg.sender?.fullName || null;
                m.content = msg.content;
                m.sentAt = msg.sentAt;
                m.isSynced = true;
                m.pendingAction = null;
              });
            }
          }));
        } catch (saveError) {
          console.log('Failed to save messages to local DB:', saveError);
        }
      } catch (error: any) {
        console.error('Failed to load messages:', error);
        setMessages([]);
      } finally {
        setLoading(false);
      }
      chatApi.markAsRead(chatId).catch(() => {});
    } else {
      // Offline and no local messages
      setMessages([]);
      setLoading(false);
    }
  }, [chatId, isOnline]);

  useEffect(() => { 
    load(); 
    return () => {
      if (typingTimer.current) {
        clearTimeout(typingTimer.current);
      }
    };
  }, [load]);

  // ─── Надіслати текст ───────────────────────────────────────────────────────
  const handleSend = async () => {
    const content = text.trim();
    if (!content || sending) return;
    setText('');
    sendTyping(chatId, false);
    
    // Save message offline first
    try {
      await SyncService.saveMessageOffline({
        chatId,
        senderId: user?.id || '',
        senderName: user?.fullName,
        content,
      });
    } catch (saveError) {
      console.log('Failed to save message offline:', saveError);
    }
    
    sendMessage(chatId, content);
  };

  const handleTyping = (val: string) => {
    setText(val);
    sendTyping(chatId, val.length > 0);
  };

  // ─── Завантажити файл і надіслати як повідомлення ─────────────────────────
  const uploadAndSend = async (
    uri: string,
    name: string,
    type: string,
  ) => {
    setUploading(true);
    try {
      const result = await chatApi.sendFile(chatId, { uri, name, type });
      // Надсилаємо через WebSocket з attachmentUrl
      sendMessage(chatId, name, result.url);
    } catch (e) {
      Alert.alert('Помилка', 'Не вдалося відправити файл');
      console.error('Upload error:', e);
    } finally {
      setUploading(false);
    }
  };

  // ─── Вибір медіа з галереї ─────────────────────────────────────────────────
  const handlePickMedia = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Потрібен дозвіл', 'Дозвольте доступ до галереї');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'] as any,
      allowsMultipleSelection: false,
      quality: 0.85,
    });
    if (result.canceled || !result.assets?.length) return;
    const asset = result.assets[0];
    const fileName = asset.fileName || asset.uri.split('/').pop() || `media_${Date.now()}`;
    const mimeType = asset.mimeType || 'image/jpeg';
    await uploadAndSend(asset.uri, fileName, mimeType);
  };

  // ─── Вибір документа ──────────────────────────────────────────────────────
  const handlePickDocument = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0];
      await uploadAndSend(asset.uri, asset.name, asset.mimeType ?? 'application/octet-stream');
    } catch (e) {
      Alert.alert('Помилка', 'Не вдалося відкрити документ');
    }
  };

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: Colors.background }}>
        <ScreenHeader title={chatName ?? 'Чат'} onBack={() => navigation.goBack()} />
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator color={Colors.primary} />
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: Colors.background }}>
      <ScreenHeader title={chatName ?? 'Чат'} onBack={() => navigation.goBack()} />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
      >
        <FlatList
          ref={flatRef}
          data={messages}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ padding: 12, paddingBottom: 4 }}
          onContentSizeChange={() => flatRef.current?.scrollToEnd({ animated: false })}
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
              onAvatarPress={(userId) => navigation.navigate('UserProfile', { userId })}
            />
          )}
        />

        {typing && (
          <View style={styles.typingBar}>
            <Text style={styles.typingText}>{typing} друкує...</Text>
          </View>
        )}

        {/* Рядок вводу */}
        <View style={styles.inputRow}>
          {/* Кнопка медіа */}
          <TouchableOpacity
            style={styles.attachBtn}
            onPress={handlePickMedia}
            disabled={uploading}
          >
            <Text style={{ fontSize: 20 }}>🖼</Text>
          </TouchableOpacity>

          {/* Кнопка файлу */}
          <TouchableOpacity
            style={styles.attachBtn}
            onPress={handlePickDocument}
            disabled={uploading}
          >
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
      </KeyboardAvoidingView>
    </View>
  );
}

// ─── MessageBubble ─────────────────────────────────────────────────────────────

function MessageBubble({
  message,
  isMine,
  staticBase,
  onAvatarPress,
}: {
  message: Message;
  isMine: boolean;
  staticBase: string;
  onAvatarPress?: (userId: string) => void;
}) {
  const isSystem = message.messageType === 'system';

  if (isSystem) {
    return (
      <View style={styles.systemMsg}>
        <Text style={styles.systemMsgText}>{message.content}</Text>
      </View>
    );
  }

  const time = new Date(message.sentAt).toLocaleTimeString('uk-UA', {
    hour: '2-digit',
    minute: '2-digit',
  });

  const hasAttachment = !!message.attachmentUrl;
  const attachUrl = hasAttachment
    ? message.attachmentUrl!.startsWith('http')
      ? message.attachmentUrl!
      : `${staticBase}${message.attachmentUrl}`
    : null;

  const isImage = attachUrl
    ? /\.(jpg|jpeg|png|gif|webp|bmp|heic)$/i.test(attachUrl)
    : false;
  const isVideo = attachUrl
    ? /\.(mp4|mov|avi|mkv|m4v)$/i.test(attachUrl)
    : false;

  return (
    <View style={[styles.bubbleWrapper, isMine && styles.bubbleWrapperMine]}>
      {!isMine && (
        <TouchableOpacity
          style={styles.senderAvatar}
          onPress={() => message.senderId && onAvatarPress?.(message.senderId)}
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

        {/* Зображення */}
        {isImage && attachUrl && (
          <Image
            source={{ uri: attachUrl }}
            style={styles.attachImage}
            resizeMode="cover"
          />
        )}

        {/* Відео / документ — плейсхолдер з іменем */}
        {!isImage && hasAttachment && attachUrl && (
          <View style={styles.attachFile}>
            <Text style={styles.attachFileIcon}>{isVideo ? '🎥' : '📄'}</Text>
            <Text style={styles.attachFileName} numberOfLines={2}>
              {message.content}
            </Text>
          </View>
        )}

        {/* Текст — показуємо тільки якщо немає вкладення */}
        {!hasAttachment && (
          <Text style={[styles.bubbleText, isMine && styles.bubbleTextMine]}>
            {message.content}
          </Text>
        )}

        <Text style={[styles.bubbleTime, isMine && { color: 'rgba(255,255,255,0.65)' }]}>
          {time}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  typingBar:    { paddingHorizontal: 16, paddingVertical: 4 },
  typingText:   { fontSize: 12, color: Colors.textMuted, fontStyle: 'italic' },

  inputRow: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 6,
    padding: 10, backgroundColor: Colors.surface,
    borderTopWidth: 1, borderTopColor: Colors.border,
  },
  attachBtn: {
    width: 40, height: 40,
    alignItems: 'center', justifyContent: 'center',
    borderRadius: 20,
  },
  input: {
    flex: 1, borderWidth: 1.5, borderColor: Colors.border,
    borderRadius: 22, paddingHorizontal: 16, paddingVertical: 10,
    fontSize: 15, maxHeight: 120, backgroundColor: Colors.surface,
    color: '#000000',
  },
  sendBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: Colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  sendBtnDisabled: { backgroundColor: Colors.borderLight },

  // Bubbles
  bubbleWrapper:     { flexDirection: 'row', alignItems: 'flex-end', marginBottom: 8, gap: 6 },
  bubbleWrapperMine: { flexDirection: 'row-reverse' },
  senderAvatar: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center',
  },
  bubble: {
    maxWidth: '75%', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 8,
    overflow: 'hidden',
  },
  bubbleMine:  { backgroundColor: Colors.primary, borderBottomRightRadius: 4 },
  bubbleOther: {
    backgroundColor: Colors.surface, borderBottomLeftRadius: 4,
    borderWidth: 1, borderColor: Colors.borderLight,
  },
  senderName:     { fontSize: 11, fontWeight: '700', color: Colors.primary, marginBottom: 3 },
  bubbleText:     { fontSize: 15, color: Colors.text, lineHeight: 20 },
  bubbleTextMine: { color: '#fff' },
  bubbleTime:     { fontSize: 10, color: Colors.textMuted, marginTop: 4, textAlign: 'right' },

  // Attachment — image
  attachImage: {
    width: 220, height: 160, borderRadius: 10, marginBottom: 6,
  },

  // Attachment — file/video
  attachFile: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(0,0,0,0.07)', borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 8, marginBottom: 6,
  },
  attachFileIcon: { fontSize: 24 },
  attachFileName: { flex: 1, fontSize: 13, color: Colors.text },

  // System
  systemMsg: {
    alignSelf: 'center', backgroundColor: Colors.borderLight,
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 6, marginBottom: 8,
  },
  systemMsgText: { fontSize: 12, color: Colors.textSecondary, textAlign: 'center' },
});
