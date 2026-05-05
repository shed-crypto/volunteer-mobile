import api from './axios';
import { Request, CreateRequestDto, FindRequestsDto } from '../types';

export const requestsApi = {
  getAll: (params?: FindRequestsDto): Promise<Request[]> =>
    api.get('/requests', { params }).then((r) => r.data),

  getOne: (id: string): Promise<Request> =>
    api.get(`/requests/${id}`).then((r) => r.data),

  getNearby: (params: { latitude: number; longitude: number; radiusKm: number }): Promise<Request[]> =>
    api.get('/requests', { params: { ...params, limit: 100 } }).then((r) => r.data),

  create: (data: CreateRequestDto): Promise<Request> =>
    api.post('/requests', data).then((r) => r.data),

  update: (id: string, data: Partial<CreateRequestDto> & { status?: string }): Promise<Request> =>
    api.patch(`/requests/${id}`, data).then((r) => r.data),

  delete: (id: string): Promise<void> =>
    api.delete(`/requests/${id}`).then(() => undefined),

  markAsPendingReview: (id: string): Promise<Request> =>
    api.post(`/requests/${id}/pending-review`).then((r) => r.data),

  confirmCompletion: (id: string): Promise<Request> =>
    api.post(`/requests/${id}/confirm-completion`).then((r) => r.data),

  returnToProgress: (id: string): Promise<Request> =>
    api.post(`/requests/${id}/return-to-progress`).then((r) => r.data),

  addInfo: (id: string, text: string, attachments?: any[]): Promise<Request> => {
    const formData = new FormData();
    formData.append('text', text);
    attachments?.forEach((file, index) => {
      formData.append('attachments', {
        uri: file.uri,
        name: file.name || `file_${index}`,
        type: file.type || 'application/octet-stream',
      } as any);
    });
    return api.patch(`/requests/${id}/add-info`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then((r) => r.data);
  },

  updateAdditionalInfo: (id: string, infoId: string, text: string, attachments?: any[]): Promise<Request> => {
    const formData = new FormData();
    formData.append('text', text);
    attachments?.forEach((file, index) => {
      formData.append('attachments', {
        uri: file.uri,
        name: file.name || `file_${index}`,
        type: file.type || 'application/octet-stream',
      } as any);
    });
    return api.patch(`/requests/${id}/additional-info/${infoId}`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then((r) => r.data);
  },

  removeAdditionalInfo: (id: string, infoId: string): Promise<Request> =>
    api.delete(`/requests/${id}/additional-info/${infoId}`).then((r) => r.data),

  save: (id: string): Promise<void> =>
    api.post(`/requests/${id}/save`).then(() => undefined),

  unsave: (id: string): Promise<void> =>
    api.delete(`/requests/${id}/save`).then(() => undefined),

  getSaved: (limit?: number, offset?: number): Promise<Request[]> =>
    api.get('/requests/saved', { params: { limit, offset } }).then((r) => r.data),
};
