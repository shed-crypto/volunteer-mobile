import api from './axios';
import { TaskReport } from '../types';

export const taskReportsApi = {
  create: (taskId: string, comment: string, attachments: any[]): Promise<TaskReport> => {
    const formData = new FormData();
    formData.append('comment', comment);

    attachments.forEach((file) => {
      // @ts-ignore: React Native FormData приймає { uri, name, type }
      formData.append('attachments', {
        uri: file.uri,
        name: file.name,
        type: file.type,
      });
    });

    return api
      .post(`/tasks/${taskId}/reports`, formData, {
        headers: {
          // Явно вказуємо multipart — axios перепише Content-Type з boundary автоматично
          'Content-Type': 'multipart/form-data',
        },
        // КРИТИЧНО: без цього axios серіалізує FormData в JSON рядок
        transformRequest: [(data) => data],
      })
      .then((r) => r.data)
      .catch((error) => {
        console.error('Report creation error:', error?.response?.data ?? error.message);
        throw error;
      });
  },

  getAll: (taskId: string): Promise<TaskReport[]> =>
    api.get(`/tasks/${taskId}/reports`).then((r) => r.data),
};
