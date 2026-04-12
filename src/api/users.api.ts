import api from './axios';
import { User, TrustVouch, Vehicle } from '../types';

export const usersApi = {
  getAll: (): Promise<User[]> =>
    api.get('/users').then((r) => r.data),

  search: (query: string): Promise<User[]> =>
    api.get(`/users/search?q=${query}`).then((r) => r.data),

  getOne: (id: string): Promise<User> =>
    api.get(`/users/${id}`).then((r) => r.data),

  updateProfile: (
    id: string,
    data: { fullName?: string; phoneNumber?: string; telegramChatId?: string },
  ): Promise<User> =>
    api.patch(`/users/${id}`, data).then((r) => r.data),

  vouch: (userId: string): Promise<TrustVouch> =>
    api.post(`/users/${userId}/vouch`).then((r) => r.data),

  getVouches: (userId: string): Promise<TrustVouch[]> =>
    api.get(`/users/${userId}/vouches`).then((r) => r.data),

  block: (userId: string): Promise<void> =>
    api.patch(`/users/${userId}/block`).then(() => undefined),

  getVehicles: (userId: string): Promise<Vehicle[]> =>
    api.get(`/users/${userId}/vehicles`).then((r) => r.data),

  addVehicle: (data: {
    type: string;
    capacityKg?: number;
    plateNumber?: string;
    status?: string;
  }): Promise<Vehicle> =>
    api.post('/users/me/vehicles', data).then((r) => r.data),
};

