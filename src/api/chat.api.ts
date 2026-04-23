import api, { API_BASE_URL } from './axios';
import * as SecureStore from 'expo-secure-store';
import { Chat, Message } from '../types';

export const chatApi = {
  getMyChats: (): Promise<Chat[]> =>
    api.get('/chats').then((r) => r.data),

  getOrCreateDirect: (targetUserId: string): Promise<Chat> =>
    api.post('/chats/direct', { targetUserId }).then((r) => r.data),

  getMessages: (chatId: string, limit = 50, beforeId?: string): Promise<Message[]> =>
    api.get(`/chats/${chatId}/messages`, { params: { limit, beforeId } }).then((r) => r.data),

  sendMessage: (chatId: string, content: string): Promise<Message> =>
    api.post(`/chats/${chatId}/messages`, { content }).then((r) => r.data),

  /**
   * Завантажує файл у чат і повертає URL збереженого файлу.
   * Використовує нативний fetch() замість Axios, щоб уникнути конфліктів
   * з Content-Type заголовком (React Native сам генерує boundary для FormData).
   */
  sendFile: async (
    chatId: string,
    file: { uri: string; name: string; type: string },
  ): Promise<{ url: string; name: string; mimeType: string }> => {
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

    try {
      const response = await fetch(`${API_BASE_URL}/chats/${chatId}/files`, {
        method: 'POST',
        body: formData,
        headers,
      });

      if (!response.ok) {
        const text = await response.text().catch(() => response.statusText);
        throw new Error(`Upload failed: ${response.status} ${text}`);
      }

      return await response.json();
    } catch (error) {
      console.error('File upload error:', error);
      throw error;
    }
  },

  markAsRead: (chatId: string): Promise<void> =>
    api.post(`/chats/${chatId}/read`).then(() => undefined),
};
