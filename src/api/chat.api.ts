import api from './axios';
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
   * URL потім передається в sendMessage як контент (або окреме поле).
   */
  sendFile: (
    chatId: string,
    file: { uri: string; name: string; type: string },
  ): Promise<{ url: string; name: string; mimeType: string }> => {
    const formData = new FormData();
    // @ts-ignore: React Native FormData приймає { uri, name, type }
    formData.append('file', { uri: file.uri, name: file.name, type: file.type });

    return api
      .post(`/chats/${chatId}/files`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        transformRequest: [(data) => data],
      })
      .then((r) => r.data);
  },

  markAsRead: (chatId: string): Promise<void> =>
    api.post(`/chats/${chatId}/read`).then(() => undefined),
};
