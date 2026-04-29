import api from './axios';
import { Task, TaskAssignment, CreateTaskDto } from '../types';

export const tasksApi = {
  getByRequest: (requestId: string): Promise<Task[]> =>
    api.get(`/requests/${requestId}/tasks`).then((r) => r.data),

  getOne: (id: string): Promise<Task> =>
    api.get(`/tasks/${id}`).then((r) => r.data),

  create: (requestId: string, data: CreateTaskDto): Promise<Task> =>
    api.post(`/requests/${requestId}/tasks`, data).then((r) => r.data),

  update: (id: string, data: Partial<CreateTaskDto>): Promise<Task> =>
    api.patch(`/tasks/${id}`, data).then((r) => r.data),

  assign: (taskId: string, fulfilledRole?: string): Promise<TaskAssignment> =>
    api.post(`/tasks/${taskId}/assign`, { fulfilledRole }).then((r) => r.data),

  withdraw: (taskId: string): Promise<void> =>
    api.delete(`/tasks/${taskId}/assign`).then(() => undefined),

  complete: (taskId: string): Promise<Task> =>
    api.patch(`/tasks/${taskId}/complete`).then((r) => r.data),

  confirm: (taskId: string): Promise<Task> =>
    api.patch(`/tasks/${taskId}/confirm`).then((r) => r.data),

  returnToProgress: (taskId: string): Promise<Task> =>
    api.patch(`/tasks/${taskId}/return`).then((r) => r.data),

  // FR-09d: відхилення результату (автор → повернення IN_PROGRESS)
  reject: (taskId: string, reason?: string): Promise<Task> =>
    api.patch(`/tasks/${taskId}/reject`, { reason }).then((r) => r.data),

  // FR-06e: оновлення статусу виконавця (EN_ROUTE / ON_SITE)
  updateAssignmentStatus: (taskId: string, status: string): Promise<TaskAssignment> =>
    api.patch(`/tasks/${taskId}/assignment-status`, { status }).then((r) => r.data),

  delegate: (taskId: string, organizationId: string, message?: string): Promise<any> =>
    api.post(`/tasks/${taskId}/delegate`, { organizationId, message }).then((r) => r.data),

  cancel: (taskId: string): Promise<Task> =>
    api.patch(`/tasks/${taskId}/cancel`).then((r) => r.data),

  renew: (taskId: string): Promise<Task> =>
    api.patch(`/tasks/${taskId}/renew`).then((r) => r.data),
};

