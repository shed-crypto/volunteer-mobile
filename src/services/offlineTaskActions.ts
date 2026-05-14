import { collections, database } from '../db/index';
import { refreshAllPendingActions } from '../hooks/usePendingActions';
import { AssignmentStatus, TaskStatus } from '../types';
import { countActiveAssignments } from '../db/helpers/assignments';

export type OfflineTaskActionType =
  | 'TASK_ASSIGN'
  | 'TASK_WITHDRAW'
  | 'TASK_COMPLETE'
  | 'TASK_RETURN_TO_PROGRESS'
  | 'TASK_UPDATE_ASSIGNMENT_STATUS';

type OfflineUser = {
  id: string;
  fullName?: string;
};

const activeAssignmentStatuses = [
  AssignmentStatus.ASSIGNED,
  AssignmentStatus.EN_ROUTE,
  AssignmentStatus.ON_SITE,
  AssignmentStatus.COMPLETED,
];

async function findLocalTask(taskId: string) {
  const tasks = await collections.tasks.query().fetch();
  return tasks.find((task: any) => task.serverId === taskId || task.id === taskId);
}

async function findLocalAssignment(taskId: string, userId: string) {
  const assignments = await collections.taskAssignments.query().fetch();
  return assignments.find((assignment: any) => assignment.taskId === taskId && assignment.userId === userId);
}

async function removeOppositeQueuedTaskAction(actionType: OfflineTaskActionType, taskId: string) {
  const oppositeAction =
    actionType === 'TASK_ASSIGN'
      ? 'TASK_WITHDRAW'
      : actionType === 'TASK_WITHDRAW'
        ? 'TASK_ASSIGN'
        : null;

  if (!oppositeAction) return;

  const queue = await collections.actionQueue.query().fetch();
  const oppositeItems = queue.filter((item: any) => {
    try {
      const payload = JSON.parse(item.payloadRaw || '{}');
      return item.actionType === oppositeAction && (payload.taskId || payload.task_id || payload.id) === taskId;
    } catch {
      return false;
    }
  });

  for (const item of oppositeItems) {
    await item.destroyPermanently();
  }
}

export async function enqueueOfflineTaskAction(
  actionType: OfflineTaskActionType,
  payload: Record<string, unknown>,
) {
  const taskId = String(payload.taskId || payload.task_id || payload.id || '');
  if (!taskId) throw new Error('taskId is required for offline task action');

  await database.write(async () => {
    await removeOppositeQueuedTaskAction(actionType, taskId);
    await collections.actionQueue.create((item: any) => {
      item.actionType = actionType;
      item.payloadRaw = JSON.stringify(payload);
      item.createdAt = Date.now();
      item.retryCount = 0;
      item.error = null;
    });
  });

  refreshAllPendingActions();
}

export async function applyOfflineTaskActionLocally(
  actionType: OfflineTaskActionType,
  taskId: string,
  user?: OfflineUser | null,
  payload: Record<string, unknown> = {},
) {
  await database.write(async () => {
    const task = await findLocalTask(taskId);
    const userId = user?.id;

    if (actionType === 'TASK_ASSIGN' && userId) {
      const existingAssignment = await findLocalAssignment(taskId, userId);
      const wasActive = existingAssignment
        ? activeAssignmentStatuses.includes((existingAssignment as any).status)
        : false;
      if (existingAssignment) {
        await existingAssignment.update((assignment: any) => {
          assignment.status = AssignmentStatus.ASSIGNED;
          assignment.userName = user.fullName ?? assignment.userName ?? null;
          assignment.fulfilledRole = (payload.fulfilledRole as string | undefined) ?? assignment.fulfilledRole ?? null;
          assignment.assignedAt = Date.now();
          assignment.isSynced = false;
          assignment.pendingAction = 'assign';
          assignment.lastSyncedAt = null;
        });
      } else {
        await collections.taskAssignments.create((assignment: any) => {
          assignment.taskId = taskId;
          assignment.userId = userId;
          assignment.userName = user.fullName ?? null;
          assignment.status = AssignmentStatus.ASSIGNED;
          assignment.fulfilledRole = (payload.fulfilledRole as string | undefined) ?? null;
          assignment.assignedAt = Date.now();
          assignment.isSynced = false;
          assignment.pendingAction = 'assign';
          assignment.lastSyncedAt = null;
        });
      }

      if (task) {
        const allAssignments = await collections.taskAssignments.query().fetch();
        const taskAssignments = (allAssignments as any[]).filter((a: any) => a.taskId === taskId);
        const nextCount = countActiveAssignments(taskAssignments);
        await task.update((t: any) => {
          t.status = nextCount > 0 ? TaskStatus.IN_PROGRESS : TaskStatus.TODO;
          t.assignedCount = nextCount;
          t.isSynced = false;
          t.pendingAction = 'assign';
        });
      }
      return;
    }

    if (actionType === 'TASK_WITHDRAW' && userId) {
      const assignment = await findLocalAssignment(taskId, userId);
      if (assignment) {
        await assignment.update((a: any) => {
          a.status = AssignmentStatus.WITHDRAWN;
          a.isSynced = false;
          a.pendingAction = 'withdraw';
          a.lastSyncedAt = null;
        });
      }

      if (task) {
        const allAssignments = await collections.taskAssignments.query().fetch();
        const taskAssignments = (allAssignments as any[]).filter((a: any) => a.taskId === taskId);
        const nextCount = countActiveAssignments(taskAssignments);
        await task.update((t: any) => {
          t.assignedCount = nextCount;
          t.status = nextCount > 0 ? TaskStatus.IN_PROGRESS : TaskStatus.TODO;
          t.isSynced = false;
          t.pendingAction = 'withdraw';
        });
      }
      return;
    }

    if (task && actionType === 'TASK_COMPLETE') {
      await task.update((t: any) => {
        t.status = TaskStatus.PENDING_REVIEW;
        t.isSynced = false;
        t.pendingAction = 'complete';
      });
      return;
    }

    if (task && actionType === 'TASK_RETURN_TO_PROGRESS') {
      await task.update((t: any) => {
        t.status = TaskStatus.IN_PROGRESS;
        t.isSynced = false;
        t.pendingAction = 'return_to_progress';
      });
      return;
    }

    if (actionType === 'TASK_UPDATE_ASSIGNMENT_STATUS' && userId) {
      const assignment = await findLocalAssignment(taskId, userId);
      if (assignment) {
        await assignment.update((a: any) => {
          a.status = payload.status as string;
          a.isSynced = false;
          a.pendingAction = 'update_status';
          a.lastSyncedAt = null;
        });
      }
    }
  });
}

export async function revertOfflineTaskActionLocally(
  actionType: OfflineTaskActionType,
  taskId: string,
  user?: OfflineUser | null,
) {
  await database.write(async () => {
    const task = await findLocalTask(taskId);
    const userId = user?.id;

    if (actionType === 'TASK_ASSIGN' && userId) {
      const assignment = await findLocalAssignment(taskId, userId);
      if (assignment) {
        await assignment.update((a: any) => {
          a.status = AssignmentStatus.WITHDRAWN;
          a.pendingAction = null;
          a.isSynced = true;
        });
      }
      if (task) {
        const allAssignments = await collections.taskAssignments.query().fetch();
        const taskAssignments = (allAssignments as any[]).filter((a: any) => a.taskId === taskId);
        const nextCount = countActiveAssignments(taskAssignments);
        await task.update((t: any) => {
          t.assignedCount = nextCount;
          t.status = nextCount > 0 ? TaskStatus.IN_PROGRESS : TaskStatus.TODO;
          t.pendingAction = null;
          t.isSynced = true;
        });
      }
      return;
    }

    if (actionType === 'TASK_WITHDRAW' && userId) {
      const assignment = await findLocalAssignment(taskId, userId);
      if (assignment) {
        await assignment.update((a: any) => {
          a.status = AssignmentStatus.ASSIGNED;
          a.pendingAction = null;
          a.isSynced = true;
        });
      }
      if (task) {
        const allAssignments = await collections.taskAssignments.query().fetch();
        const taskAssignments = (allAssignments as any[]).filter((a: any) => a.taskId === taskId);
        const nextCount = countActiveAssignments(taskAssignments);
        await task.update((t: any) => {
          t.assignedCount = nextCount;
          t.status = nextCount > 0 ? TaskStatus.IN_PROGRESS : TaskStatus.TODO;
          t.pendingAction = null;
          t.isSynced = true;
        });
      }
      return;
    }

    if (task && actionType === 'TASK_COMPLETE') {
      await task.update((t: any) => {
        t.status = TaskStatus.IN_PROGRESS;
        t.pendingAction = null;
        t.isSynced = true;
      });
      return;
    }

    if (task && actionType === 'TASK_RETURN_TO_PROGRESS') {
      await task.update((t: any) => {
        t.status = TaskStatus.PENDING_REVIEW;
        t.pendingAction = null;
        t.isSynced = true;
      });
      return;
    }

    if (actionType === 'TASK_UPDATE_ASSIGNMENT_STATUS' && userId) {
      const assignment = await findLocalAssignment(taskId, userId);
      if (assignment) {
        await assignment.update((a: any) => {
          a.status = AssignmentStatus.ASSIGNED;
          a.pendingAction = null;
          a.isSynced = true;
        });
      }
    }
  });
}

export async function cancelOfflineTaskAction(
  actionId: string,
  actionType: OfflineTaskActionType,
  taskId: string,
  user?: OfflineUser | null,
) {
  const queue = await collections.actionQueue.query().fetch();
  const item = queue.find((queued: any) => queued.id === actionId);
  if (item) {
    await database.write(async () => {
      await item.destroyPermanently();
    });
  }
  await revertOfflineTaskActionLocally(actionType, taskId, user);
  refreshAllPendingActions();
}
