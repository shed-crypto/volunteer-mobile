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
};
