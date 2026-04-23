/**
 * Singleton WebSocket — одне з'єднання на весь додаток.
 *
 * ВИПРАВЛЕННЯ: прибрано collections.chatMessages.find(msg.id) + database.write()
 * з обробника 'new_message'. Проблема: find() шукав за WatermelonDB internal ID,
 * а msg.id — серверний UUID → завжди throw → database.write() для кожного
 * повідомлення → черга WatermelonDB флудилась writes → ChatRoomScreen.fetch()
 * зависав назавжди.
 *
 * Збереження повідомлень в локальну БД відбувається в ChatRoomScreen.load()
 * та SyncService.pull() — не в сокет-хендлері.
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
type MessageHandler  = (msg: Message & { senderName: string }) => void;
type TypingHandler   = (data: { userId: string; name: string; isTyping: boolean }) => void;
type NewChatHandler  = (data: { chatId: string; chatName: string }) => void;

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
    // ВИПРАВЛЕНО: НЕ робимо жодних DB-операцій тут.
    // Раніше тут був find() + database.write() — це флудило WatermelonDB-чергу.
    // Збереження в БД відбувається в ChatRoomScreen.load() після отримання з API.
    messageListeners.forEach((fn) => fn(msg));
  });

  socket.on('user_typing', (data: { userId: string; name: string; isTyping: boolean }) => {
    typingListeners.forEach((fn) => fn(data));
  });

  socket.on('new_chat_joined', (data: { chatId: string; chatName: string }) => {
    newChatListeners.forEach((fn) => fn(data));
  });

  globalSocket = socket;
  return socket;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

interface UseSocketOptions {
  onNewMessage?:    MessageHandler;
  onTyping?:        TypingHandler;
  onNewChatJoined?: NewChatHandler;
}

export function useSocket(options: UseSocketOptions = {}) {
  const socketRef    = useRef<Socket | null>(null);
  const optionsRef   = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    listenerCount++;

    const msgHandler:  MessageHandler  = (msg) => optionsRef.current.onNewMessage?.(msg);
    const typHandler:  TypingHandler   = (d)   => optionsRef.current.onTyping?.(d);
    const chatHandler: NewChatHandler  = (d)   => optionsRef.current.onNewChatJoined?.(d);

    if (options.onNewMessage)    messageListeners.add(msgHandler);
    if (options.onTyping)        typingListeners.add(typHandler);
    if (options.onNewChatJoined) newChatListeners.add(chatHandler);

    getOrCreateSocket().then((s) => { socketRef.current = s; });

    return () => {
      listenerCount--;
      messageListeners.delete(msgHandler);
      typingListeners.delete(typHandler);
      newChatListeners.delete(chatHandler);

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

// Додано: публічна функція для безпечної відправки через WebSocket
export async function emitWhenReady(event: string, data: object): Promise<void> {
  const socket = await getOrCreateSocket();
  socket.emit(event, data);
}
