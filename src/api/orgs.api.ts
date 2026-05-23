import api from './axios';
import {
  Organization,
  OrganizationMember,
  OrgRole,
  Hub,
  OrganizationSettings,
  OrganizationJoinRequest,
  Request,
  Task,
} from '../types';
import { fileUtils, getMediaUrl } from '../utils/fileUtils';

type HubPayload = {
  name: string;
  address?: string;
  description?: string;
  latitude?: number;
  longitude?: number;
  isPublic?: boolean;
  mediaUrl?: string | null;
};

type UpdateOrganizationPayload = Omit<Partial<Organization>, 'logoUrl'> & {
  logoUrl?: string | null;
};

async function appendImage(formData: FormData, fileUri: string, fallbackName: string) {
  const rawName = fileUri.split('/').pop() || fallbackName;
  const ext = rawName.split('.').pop()?.toLowerCase();
  const fallbackType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
  const file = await fileUtils.normalizeImagePickerAsset(fileUri, rawName, fallbackType);
  formData.append('file', { uri: file.uri, name: file.name, type: file.mimeType } as any);
}

export const orgsApi = {
  getAll: (params?: { parentOrgId?: string }): Promise<Organization[]> =>
    api.get('/organizations', { params }).then((r) => r.data),

  getOne: (id: string): Promise<Organization> =>
    api.get(`/organizations/${id}`).then((r) => r.data),

  create: (data: { name: string; description?: string; parentOrgId?: string; tags?: string[] }): Promise<Organization> =>
    api.post('/organizations', data).then((r) => r.data),

  getMembers: (id: string): Promise<OrganizationMember[]> =>
    api.get(`/organizations/${id}/members`).then((r) => r.data),

  getTasks: (id: string): Promise<Task[]> =>
    api.get(`/organizations/${id}/tasks`).then((r) => r.data),

  getRequests: (id: string): Promise<Request[]> =>
    api.get(`/organizations/${id}/requests`).then((r) => r.data),

  addMember: (id: string, userId: string, role: OrgRole): Promise<OrganizationMember> =>
    api.post(`/organizations/${id}/members`, { userId, role }).then((r) => r.data),

  removeMember: (id: string, userId: string): Promise<void> =>
    api.delete(`/organizations/${id}/members/${userId}`).then(() => undefined),

  inviteMember: (id: string, email: string): Promise<OrganizationMember> =>
    api.post(`/organizations/${id}/invite`, { email }).then((r) => r.data),

  getHubs: (id: string): Promise<Hub[]> =>
    api.get(`/organizations/${id}/hubs`).then((r) => r.data),

  createHub: (
    id: string,
    data: HubPayload,
  ): Promise<Hub> =>
    api.post(`/organizations/${id}/hubs`, data).then((r) => r.data),

  updateHub: (orgId: string, hubId: string, data: Partial<HubPayload>): Promise<Hub> =>
    api.patch(`/organizations/${orgId}/hubs/${hubId}`, data).then((r) => r.data),

  search: (q: string): Promise<Organization[]> =>
    api.get('/organizations/search/query', { params: { q } }).then((r) => r.data),

  update: (id: string, data: UpdateOrganizationPayload): Promise<Organization> =>
    api.patch(`/organizations/${id}`, data).then((r) => r.data),

  getSettings: (id: string): Promise<OrganizationSettings> =>
    api.get(`/organizations/${id}/settings`).then((r) => r.data),

  updateSettings: (id: string, data: Partial<OrganizationSettings>): Promise<OrganizationSettings> =>
    api.patch(`/organizations/${id}/settings`, data).then((r) => r.data),

  delete: (id: string): Promise<void> =>
    api.delete(`/organizations/${id}`).then(() => undefined),

  leave: (id: string): Promise<void> =>
    api.post(`/organizations/${id}/leave`).then(() => undefined),

  updateMemberRole: (orgId: string, userId: string, role: string, isDeputy?: boolean): Promise<OrganizationMember> =>
    api.patch(`/organizations/${orgId}/members/${userId}/role`, { role, isDeputy }).then((r) => r.data),

  deleteHub: (orgId: string, hubId: string): Promise<void> =>
    api.delete(`/organizations/${orgId}/hubs/${hubId}`).then(() => undefined),

  join: (id: string, message?: string): Promise<OrganizationJoinRequest> =>
    api.post(`/organizations/${id}/join`, { message }).then((r) => r.data),

  getJoinRequests: (id: string): Promise<OrganizationJoinRequest[]> =>
    api.get(`/organizations/${id}/join-requests`).then((r) => r.data),

  approveRequest: (id: string, requestId: string, comment?: string): Promise<void> =>
    api.post(`/organizations/${id}/join-requests/${requestId}/approve`, { comment }).then(() => undefined),

  rejectRequest: (id: string, requestId: string, comment?: string): Promise<void> =>
    api.post(`/organizations/${id}/join-requests/${requestId}/reject`, { comment }).then(() => undefined),

  uploadLogo: async (id: string, fileUri: string): Promise<{ url: string }> => {
    const formData = new FormData();
    await appendImage(formData, fileUri, 'logo.jpg');
    return api.post(`/organizations/${id}/upload-logo`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then((r) => r.data);
  },

  createChat: (id: string): Promise<Organization> =>
    api.post(`/organizations/${id}/create-chat`).then((r) => r.data),

  uploadBanner: async (id: string, fileUri: string): Promise<{ url: string }> => {
    const formData = new FormData();
    await appendImage(formData, fileUri, 'banner.jpg');
    return api.post(`/organizations/${id}/upload-banner`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then((r) => r.data);
  },

  getDelegations: (id: string): Promise<any[]> =>
    api.get(`/organizations/${id}/delegations`).then((r) => r.data),

  acceptDelegation: (taskId: string, orgId: string): Promise<any> =>
    api.post(`/tasks/${taskId}/delegation/accept`, { organizationId: orgId }).then((r) => r.data),

  unacceptDelegation: (taskId: string, orgId: string): Promise<any> =>
    api.post(`/tasks/${taskId}/delegation/unaccept`, { organizationId: orgId }).then((r) => r.data),

  declineDelegation: (taskId: string, orgId: string): Promise<any> =>
    api.post(`/tasks/${taskId}/delegation/decline`, { organizationId: orgId }).then((r) => r.data),

  getMemberPrivileges: (id: string): Promise<{ 
    canEdit: boolean; 
    canDelete: boolean; 
    canManageMembers: boolean;
    canManageHubs: boolean;
    isLeader: boolean;
    isCoordinator: boolean;
    isDeputy: boolean;
  }> => api.get(`/organizations/${id}/members/me/privileges`).then((r) => r.data),

  uploadHubMedia: async (orgId: string, hubId: string, fileUri: string): Promise<{ url: string }> => {
    const formData = new FormData();
    await appendImage(formData, fileUri, 'hub.jpg');
    return api.post(`/organizations/${orgId}/hubs/${hubId}/upload-media`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    }).then((r) => r.data);
  },

  resolveMediaUrl: getMediaUrl,
};
