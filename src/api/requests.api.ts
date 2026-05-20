import api from './axios';
import { Request, CreateRequestDto, FindRequestsDto } from '../types';

export const requestsApi = {
  getAll: (params?: FindRequestsDto & { latitude?: number; longitude?: number }): Promise<any[]> =>
    api.get('/requests', { params }).then((r) => {
      const firstItem = r.data && r.data[0];
      console.log('[API] /requests response sample:', firstItem?.id, 'isSaved:', firstItem?.isSaved);
      return r.data;
    }),

  getSavedIds: (): Promise<string[]> =>
    api.get('/requests/saved-ids').then((r) => r.data),

  getOne: (id: string): Promise<Request> =>
    api.get(`/requests/${id}`).then((r) => r.data),

  getNearby: (params: { latitude: number; longitude: number; radiusKm: number }): Promise<Request[]> =>
    api.get('/requests', { params: { ...params, limit: 100 } }).then((r) => r.data),

  create: (data: CreateRequestDto): Promise<Request> => {
    // Check if files are present
    if ((data as any).attachments?.length > 0) {
      const formData = new FormData();
      formData.append('title', data.title!);
      if (data.description) formData.append('description', data.description);
      if (data.category) formData.append('category', data.category);
      if (data.urgency) formData.append('urgency', data.urgency);
      if (data.requiredClearance) formData.append('requiredClearance', data.requiredClearance);
      if (data.address) formData.append('address', data.address);
      if (data.latitude != null) formData.append('latitude', String(data.latitude));
      if (data.longitude != null) formData.append('longitude', String(data.longitude));
      if (data.isLocationHidden != null) formData.append('isLocationHidden', String(data.isLocationHidden));
      if (data.fundraisingUrl) formData.append('fundraisingUrl', data.fundraisingUrl);
      (data as any).attachments.forEach((f: any) => {
        formData.append('attachments', {
          uri: f.uri,
          name: f.name || 'file',
          type: f.type || 'application/octet-stream',
        } as any);
      });
      return api.post('/requests', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      }).then((r) => r.data);
    }
    return api.post('/requests', data).then((r) => r.data);
  },

  update: (id: string, data: Partial<CreateRequestDto> & { status?: string; attachments?: any[] }): Promise<Request> => {
    // Check if files are present
    if ((data as any).attachments?.length > 0) {
      const formData = new FormData();
      if (data.title) formData.append('title', data.title);
      if (data.description) formData.append('description', data.description);
      if (data.category) formData.append('category', data.category);
      if (data.urgency) formData.append('urgency', data.urgency);
      if (data.requiredClearance) formData.append('requiredClearance', data.requiredClearance);
      if (data.latitude != null) formData.append('latitude', String(data.latitude));
      if (data.longitude != null) formData.append('longitude', String(data.longitude));
      if (data.isLocationHidden != null) formData.append('isLocationHidden', String(data.isLocationHidden));
      if (data.fundraisingUrl) formData.append('fundraisingUrl', data.fundraisingUrl);
      (data as any).attachments.forEach((f: any) => {
        formData.append('attachments', {
          uri: f.uri,
          name: f.name || 'file',
          type: f.type || 'application/octet-stream',
        } as any);
      });
      return api.patch(`/requests/${id}`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      }).then((r) => r.data);
    }
    return api.patch(`/requests/${id}`, data).then((r) => r.data);
  },

  delete: (id: string): Promise<void> =>
    api.delete(`/requests/${id}`).then(() => undefined),

  cancel: (id: string, reason?: string): Promise<Request> =>
    api.post(`/requests/${id}/cancel`, { reason }).then((r) => r.data),

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

  updateAdditionalInfo: (id: string, infoId: string, text: string, attachments?: any[], removedAttachments?: string[]): Promise<Request> => {
    const formData = new FormData();
    formData.append('text', text);
    if (removedAttachments?.length) {
      formData.append('removedAttachments', JSON.stringify(removedAttachments));
    }
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
