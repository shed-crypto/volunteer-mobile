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
  sendFile: async (
    chatId: string,
    file: { uri: string; name: string; type: string },
  ): Promise<{ url: string; name: string; mimeType: string }> => {
    const formData = new FormData();
    
    // Для React Native потрібно використовувати правильний формат
    if (file.uri.startsWith('file://') || file.uri.startsWith('content://')) {
      // Для файлів з файлової системи
      formData.append('file', {
        uri: file.uri,
        name: file.name,
        type: file.type,
      } as any);
    } else if (file.uri.startsWith('data:')) {
      // Для base64 даних
      const base64Data = file.uri.split(',')[1];
      const byteString = atob(base64Data);
      const ab = new ArrayBuffer(byteString.length);
      const ia = new Uint8Array(ab);
      for (let i = 0; i < byteString.length; i++) {
        ia[i] = byteString.charCodeAt(i);
      }
      const blob = new Blob([ab], { type: file.type });
      formData.append('file', blob, file.name);
    } else {
      // Для інших випадків
      formData.append('file', {
        uri: file.uri,
        name: file.name,
        type: file.type,
      } as any);
    }

    try {
      const response = await api.post(`/chats/${chatId}/files`, formData, {
        headers: { 
          'Content-Type': 'multipart/form-data',
        },
      });
      return response.data;
    } catch (error) {
      console.error('File upload error:', error);
      throw error;
    }
  },

  markAsRead: (chatId: string): Promise<void> =>
    api.post(`/chats/${chatId}/read`).then(() => undefined),
};
