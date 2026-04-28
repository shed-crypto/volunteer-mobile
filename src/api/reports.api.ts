import api from './axios';
import { TaskReport } from '../types';

export const reportsApi = {
  getByTask: (taskId: string): Promise<TaskReport[]> =>
    api.get(`/tasks/${taskId}/reports`).then((r) => r.data),

  create: (taskId: string, formData: FormData): Promise<TaskReport> =>
    api.post(`/tasks/${taskId}/reports`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then((r) => r.data),

  update: (taskId: string, reportId: string, comment: string): Promise<TaskReport> =>
    api.post(`/tasks/${taskId}/reports/${reportId}/edit`, { comment }).then((r) => r.data),

  delete: (taskId: string, reportId: string): Promise<void> =>
    api.post(`/tasks/${taskId}/reports/${reportId}/delete`).then(() => undefined),
};
