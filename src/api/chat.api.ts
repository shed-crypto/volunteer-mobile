import api, { API_BASE_URL } from './axios';
import { Chat, Message, User } from '../types';
import { uploadFormData } from './upload';

export const chatApi = {
  getMyChats: (): Promise<Chat[]> =>
    api.get('/chats').then((r) => r.data),

  getOrCreateDirect: (targetUserId: string): Promise<Chat> =>
    api.post('/chats/direct', { targetUserId }).then((r) => r.data),

  getMessages: (chatId: string, limit = 50, beforeId?: string, sort: 'ASC' | 'DESC' = 'ASC'): Promise<Message[]> =>
    api.get(`/chats/${chatId}/messages`, { params: { limit, beforeId, sort } }).then((r) => r.data),

  getLatestMessages: (chatId: string, limit = 50): Promise<Message[]> =>
    api.get(`/chats/${chatId}/messages`, { params: { limit, sort: 'DESC' } }).then((r) => r.data),

  sendMessage: (chatId: string, content: string, replyToId?: string, attachmentUrl?: string): Promise<Message> =>
    api.post(`/chats/${chatId}/messages`, {
      content,
      replyToId,
      attachmentUrl,
      messageType: attachmentUrl ? 'attachment' : 'text',
    }).then((r) => r.data),

  /**
   * Завантажує файл у чат і повертає URL збереженого файлу.
   * Використовує нативний fetch() замість Axios, щоб уникнути конфліктів
   * з Content-Type заголовком (React Native сам генерує boundary для FormData).
   */
  sendFile: async (
    chatId: string,
    file: { uri: string; name: string; type: string },
    onProgress?: (progress: number) => void,
    abortSignal?: { aborted: boolean; onAbort?: () => void },
  ): Promise<{ url: string; name: string; mimeType: string }> => {
    const formData = new FormData();
    formData.append('file', {
      uri: file.uri,
      name: file.name,
      type: file.type,
    } as any);

    const url = `${API_BASE_URL}/chats/${chatId}/files`;

    try {
      const json = await uploadFormData<{ url: string; name: string; mimeType: string }>(url, formData, onProgress, abortSignal);
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
