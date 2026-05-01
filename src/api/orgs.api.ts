import api from './axios';
import {
  Organization,
  OrganizationMember,
  OrgRole,
  Hub,
  OrganizationSettings,
  OrganizationJoinRequest,
} from '../types';

export const orgsApi = {
  getAll: (params?: { parentOrgId?: string }): Promise<Organization[]> =>
    api.get('/organizations', { params }).then((r) => r.data),

  getOne: (id: string): Promise<Organization> =>
    api.get(`/organizations/${id}`).then((r) => r.data),

  create: (data: { name: string; description?: string; parentOrgId?: string }): Promise<Organization> =>
    api.post('/organizations', data).then((r) => r.data),

  getMembers: (id: string): Promise<OrganizationMember[]> =>
    api.get(`/organizations/${id}/members`).then((r) => r.data),

  addMember: (id: string, userId: string, role: OrgRole): Promise<OrganizationMember> =>
    api.post(`/organizations/${id}/members`, { userId, role }).then((r) => r.data),

  removeMember: (id: string, userId: string): Promise<void> =>
    api.delete(`/organizations/${id}/members/${userId}`).then(() => undefined),

  /** FR-03d: запросити учасника за email */
  inviteMember: (id: string, email: string): Promise<OrganizationMember> =>
    api.post(`/organizations/${id}/invite`, { email }).then((r) => r.data),

  /** FR-03f: хаби / склади організації */
  getHubs: (id: string): Promise<Hub[]> =>
    api.get(`/organizations/${id}/hubs`).then((r) => r.data),

  createHub: (
    id: string,
    data: { name: string; address?: string; latitude?: number; longitude?: number },
  ): Promise<Hub> =>
    api.post(`/organizations/${id}/hubs`, data).then((r) => r.data),

  search: (q: string): Promise<Organization[]> =>
    api.get('/organizations/search/query', { params: { q } }).then((r) => r.data),

  update: (id: string, data: Partial<Organization>): Promise<Organization> =>
    api.patch(`/organizations/${id}`, data).then((r) => r.data),

  getSettings: (id: string): Promise<OrganizationSettings> =>
    api.get(`/organizations/${id}/settings`).then((r) => r.data),

  updateSettings: (id: string, data: Partial<OrganizationSettings>): Promise<OrganizationSettings> =>
    api.patch(`/organizations/${id}/settings`, data).then((r) => r.data),

  join: (id: string, message?: string): Promise<OrganizationJoinRequest> =>
    api.post(`/organizations/${id}/join`, { message }).then((r) => r.data),

  getJoinRequests: (id: string): Promise<OrganizationJoinRequest[]> =>
    api.get(`/organizations/${id}/join-requests`).then((r) => r.data),

  approveRequest: (id: string, requestId: string, comment?: string): Promise<void> =>
    api.post(`/organizations/${id}/join-requests/${requestId}/approve`, { comment }).then(() => undefined),

  rejectRequest: (id: string, requestId: string, comment?: string): Promise<void> =>
    api.post(`/organizations/${id}/join-requests/${requestId}/reject`, { comment }).then(() => undefined),
};
