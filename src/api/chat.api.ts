import api, { API_BASE_URL } from './axios';
import * as SecureStore from 'expo-secure-store';
import { Chat, Message, User } from '../types';

export const chatApi = {
  getMyChats: (): Promise<Chat[]> =>
    api.get('/chats').then((r) => r.data),

  getOrCreateDirect: (targetUserId: string): Promise<Chat> =>
    api.post('/chats/direct', { targetUserId }).then((r) => r.data),

  getMessages: (chatId: string, limit = 50, beforeId?: string): Promise<Message[]> =>
    api.get(`/chats/${chatId}/messages`, { params: { limit, beforeId } }).then((r) => r.data),

  sendMessage: (chatId: string, content: string, replyToId?: string): Promise<Message> =>
    api.post(`/chats/${chatId}/messages`, { content, replyToId }).then((r) => r.data),

  /**
   * Завантажує файл у чат і повертає URL збереженого файлу.
   * Використовує нативний fetch() замість Axios, щоб уникнути конфліктів
   * з Content-Type заголовком (React Native сам генерує boundary для FormData).
   */
  sendFile: async (
    chatId: string,
    file: { uri: string; name: string; type: string },
  ): Promise<{ url: string; name: string; mimeType: string }> => {
    console.log('[chatApi.sendFile] input file:', file);
    const formData = new FormData();
    formData.append('file', {
      uri: file.uri,
      name: file.name,
      type: file.type,
    } as any);

    const token = await SecureStore.getItemAsync('accessToken');
    const headers: Record<string, string> = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const url = `${API_BASE_URL}/chats/${chatId}/files`;
    console.log('[chatApi.sendFile] posting to:', url, 'headers keys:', Object.keys(headers));

    try {
      const response = await fetch(url, {
        method: 'POST',
        body: formData,
        headers,
      });

      console.log('[chatApi.sendFile] response status:', response.status);
      if (!response.ok) {
        const text = await response.text().catch(() => response.statusText);
        console.error('[chatApi.sendFile] response error text:', text);
        throw new Error(`Upload failed: ${response.status} ${text}`);
      }

      const json = await response.json();
      console.log('[chatApi.sendFile] response json:', json);
      return json;
    } catch (error: any) {
      console.error('[chatApi.sendFile] fetch error:', error.message, error);
      throw error;
    }
  },

  markAsRead: (chatId: string): Promise<void> =>
    api.post(`/chats/${chatId}/read`).then(() => undefined),

  deleteMessage: (chatId: string, messageId: string): Promise<void> =>
    api.delete(`/chats/${chatId}/messages/${messageId}`).then(() => undefined),

  deleteChat: (chatId: string): Promise<void> =>
    api.delete(`/chats/${chatId}`).then(() => undefined),

  clearChatHistory: (chatId: string): Promise<void> =>
    api.delete(`/chats/${chatId}/messages`).then(() => undefined),

  togglePin: (chatId: string): Promise<Chat> =>
    api.patch(`/chats/${chatId}/pin`).then((r) => r.data),

  getChatParticipants: (chatId: string): Promise<User[]> =>
    api.get(`/chats/${chatId}/participants`).then((r) => r.data),

  forwardMessage: (chatId: string, content: string, originalMessageId?: string): Promise<Message> =>
    api.post(`/chats/${chatId}/messages`, {
      content,
      messageType: 'forwarded',
      replyTo: originalMessageId
    }).then((r) => r.data),
};
