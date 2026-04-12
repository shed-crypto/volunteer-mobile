import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, FlatList, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, StyleSheet, ActivityIndicator,
} from 'react-native';
import { useRoute, RouteProp, useNavigation } from '@react-navigation/native';
import { chatApi } from '../../api/chat.api';
import { Message } from '../../types';
import { Colors } from '../../utils/theme';
import { ScreenHeader } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { useSocket } from '../../hooks/useSocket';

type RouteParams = { ChatRoom: { chatId: string; chatName?: string } };

export default function ChatRoomScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<RouteParams, 'ChatRoom'>>();
  const { chatId, chatName } = route.params;
  const { user } = useAuth();

  const [messages, setMessages]   = useState<Message[]>([]);
  const [loading, setLoading]     = useState(true);
  const [text, setText]           = useState('');
  const [typing, setTyping]       = useState<string | null>(null);
  const [sending, setSending]     = useState(false);
  const flatRef = useRef<FlatList>(null);
  const typingTimer = useRef<any>(null);

  // ─── WebSocket ───────────────────────────────────────────────────────────
  const { sendMessage, sendTyping } = useSocket({
    onNewMessage: (msg) => {
      if (msg.chatId === chatId) {
        setMessages((prev) => {
          // avoid duplicate if we already have it
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

  // ─── Load history ────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    if (!chatId) {
      setLoading(false);
      return;
    }
    
    try {
      const data = await chatApi.getMessages(chatId, 50);
      setMessages(data);
      setTimeout(() => flatRef.current?.scrollToEnd({ animated: false }), 100);
    } catch (error: any) {
      console.error('Failed to load messages:', error);
      setMessages([]);
      // Optionally show error to user
    } finally {
      setLoading(false);
    }
    // Mark as read (only if we successfully loaded messages)
    if (chatId) {
      chatApi.markAsRead(chatId).catch((error) => {
        console.error('Failed to mark chat as read:', error);
        // Don't setLoading(false) here as it's already handled above
      });
    }
  }, [chatId]);

  useEffect(() => { load(); }, [load]);

  // ─── Send ────────────────────────────────────────────────────────────────
  const handleSend = async () => {
    const content = text.trim();
    if (!content) return;
    setText('');
    sendTyping(chatId, false);
    
    // Відправляємо через WebSocket — gateway збереже й розішле всім
    sendMessage(chatId, content);
  };

  const handleTyping = (val: string) => {
    setText(val);
    sendTyping(chatId, val.length > 0);
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

       <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}>
        {/* Messages */}
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
              onAvatarPress={(userId) => navigation.navigate('UserProfile', { userId })}
            />
          )}
        />

        {/* Typing indicator */}
        {typing && (
          <View style={styles.typingBar}>
            <Text style={styles.typingText}>{typing} друкує...</Text>
          </View>
        )}

        {/* Input */}
        <View style={styles.inputRow}>
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
      </KeyboardAvoidingView>
    </View>
  );
}

function MessageBubble({
  message,
  isMine,
  onAvatarPress,
}: {
  message: Message;
  isMine: boolean;
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

  const time = new Date(message.sentAt).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });

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
        <Text style={[styles.bubbleText, isMine && styles.bubbleTextMine]}>
          {message.content}
        </Text>
        <Text style={[styles.bubbleTime, isMine && { color: 'rgba(255,255,255,0.65)' }]}>{time}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  typingBar: { paddingHorizontal: 16, paddingVertical: 4 },
  typingText: { fontSize: 12, color: Colors.textMuted, fontStyle: 'italic' },
  inputRow: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 10,
    padding: 10, backgroundColor: Colors.surface,
    borderTopWidth: 1, borderTopColor: Colors.border,
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
  bubbleWrapper: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: 8, gap: 6 },
  bubbleWrapperMine: { flexDirection: 'row-reverse' },
  senderAvatar: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center',
  },
  bubble: {
    maxWidth: '75%', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 8,
  },
  bubbleMine: {
    backgroundColor: Colors.primary,
    borderBottomRightRadius: 4,
  },
  bubbleOther: {
    backgroundColor: Colors.surface,
    borderBottomLeftRadius: 4,
    borderWidth: 1, borderColor: Colors.borderLight,
  },
  senderName: { fontSize: 11, fontWeight: '700', color: Colors.primary, marginBottom: 3 },
  bubbleText: { fontSize: 15, color: Colors.text, lineHeight: 20 },
  bubbleTextMine: { color: '#fff' },
  bubbleTime: { fontSize: 10, color: Colors.textMuted, marginTop: 4, textAlign: 'right' },
  // System
  systemMsg: {
    alignSelf: 'center', backgroundColor: Colors.borderLight,
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 6, marginBottom: 8,
  },
  systemMsgText: { fontSize: 12, color: Colors.textSecondary, textAlign: 'center' },
});
