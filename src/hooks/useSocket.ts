/**
 * Singleton WebSocket — одне з'єднання на весь додаток.
 * Виправляє баг 5.2.2: раніше кожен ChatRoomScreen створював окремий
 * socket та відключав його при виході, що призводило до втрати підписок.
 */
import { useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import * as SecureStore from 'expo-secure-store';
import { API_BASE_URL } from '../api/axios';
import { Message } from '../types';

const WS_URL = API_BASE_URL.replace('/api', '');

// ─── Глобальний singleton ─────────────────────────────────────────────────────
let globalSocket: Socket | null = null;
let listenerCount = 0;
type MessageHandler = (msg: Message & { senderName: string }) => void;
type TypingHandler  = (data: { userId: string; name: string; isTyping: boolean }) => void;
type NewChatHandler = (data: { chatId: string; chatName: string }) => void;

const messageListeners = new Set<MessageHandler>();
const typingListeners  = new Set<TypingHandler>();
const newChatListeners = new Set<NewChatHandler>();

async function getOrCreateSocket(): Promise<Socket> {
  if (globalSocket?.connected) return globalSocket;

  const token = await SecureStore.getItemAsync('accessToken');
  if (!token) throw new Error('No token');

  if (globalSocket) {
    globalSocket.disconnect();
    globalSocket = null;
  }

  const socket = io(`${WS_URL}/chat`, {
    auth: { token },
    transports: ['websocket'],
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 2000,
  });

  socket.on('new_message', (msg: Message & { senderName: string }) => {
    messageListeners.forEach((fn) => fn(msg));
  });

  socket.on('user_typing', (data: { userId: string; name: string; isTyping: boolean }) => {
    typingListeners.forEach((fn) => fn(data));
  });

  // FR-10e fix: сервер повідомляє про нову кімнату
  socket.on('new_chat_joined', (data: { chatId: string; chatName: string }) => {
    newChatListeners.forEach((fn) => fn(data));
  });

  globalSocket = socket;
  return socket;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

interface UseSocketOptions {
  onNewMessage?:   MessageHandler;
  onTyping?:       TypingHandler;
  onNewChatJoined?: NewChatHandler;
}

export function useSocket(options: UseSocketOptions = {}) {
  const socketRef    = useRef<Socket | null>(null);
  const optionsRef   = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    listenerCount++;

    // Реєструємо обробники
    const msgHandler: MessageHandler = (msg) => optionsRef.current.onNewMessage?.(msg);
    const typHandler: TypingHandler  = (d)   => optionsRef.current.onTyping?.(d);
    const chatHandler: NewChatHandler = (d)  => optionsRef.current.onNewChatJoined?.(d);

    if (options.onNewMessage)    messageListeners.add(msgHandler);
    if (options.onTyping)        typingListeners.add(typHandler);
    if (options.onNewChatJoined) newChatListeners.add(chatHandler);

    getOrCreateSocket().then((s) => { socketRef.current = s; });

    return () => {
      listenerCount--;
      messageListeners.delete(msgHandler);
      typingListeners.delete(typHandler);
      newChatListeners.delete(chatHandler);

      // Відключаємо глобальний сокет лише коли жодного підписника немає
      if (listenerCount === 0) {
        globalSocket?.disconnect();
        globalSocket = null;
      }
    };
  }, []);

  const sendMessage = useCallback((chatId: string, content: string, attachmentUrl?: string) => {
    globalSocket?.emit('send_message', { chatId, content, attachmentUrl });
  }, []);

  const sendTyping = useCallback((chatId: string, isTyping: boolean) => {
    globalSocket?.emit('typing', { chatId, isTyping });
  }, []);

  return { sendMessage, sendTyping, socket: socketRef };
}
