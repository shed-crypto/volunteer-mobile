/**
 * usePendingActions.ts
 * --------------------
 * Hook для відстеження pending actions у action_queue для конкретного taskId.
 *
 * GLOBAL IMMEDIATE CACHE:
 * - setPendingActionImmediate(taskId, actionType, payload) — синхронно додає запис
 *   до глобального кешу, без очікування БД. Використовується для негайного
 *   оновлення UI до того, як async DB write завершиться.
 * - removePendingActionImmediate(taskId, actionType) — синхронно видаляє.
 * - usePendingActions(taskId) повертає мердж: глобальний кеш + DB-дані.
 * - Коли DB-дані завантажаться, глобальний кеш очищується.
 * - dedup: enqueue не створює дублікат, якщо такий actionType вже є в кеші.
 *
 * СПІЛЬНА ФУНКЦІЯ enqueueOfflineAction:
 * - Додана в return hook'а, щоб і TaskCard, і TaskDetailScreen
 *   використовували ОДНАКОВИЙ код замість дублювання.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { collections, safeWrite } from '../db/index';
import { ActionQueueItem } from '../db/models/ActionQueueItem';
import { useAuth } from '../context/AuthContext';
import { AssignmentStatus, TaskStatus } from '../types';
import { countActiveAssignments } from '../db/helpers/assignments';

/* ────────── Types ────────── */

export interface PendingAction {
  id: string;
  actionType: string;
  payload: any;
  createdAt: number;
}

export type ActionButtonState = 'idle' | 'pending' | 'success' | 'error';

export interface PendingActionsInfo {
  /** всі pending actions для taskId (у порядку created_at) */
  pendingActions: PendingAction[];
  /** чи є хоч одна action? */
  hasAny: boolean;
  /** чи конкретний тип action? (без аргумента – будь-який) */
  hasAction: (actionType?: string) => boolean;
  /** отримати конкретну action за типом */
  getAction: (actionType: string) => PendingAction | undefined;
  /** скасувати action по id */
  removePendingAction: (actionId: string) => Promise<void>;
  /** оновити local state з БД */
  refresh: () => Promise<void>;
  /** СПІЛЬНА: закинути дію в чергу (offline або online fallback) */
  enqueueOfflineAction: (actionType: string, payload: any) => Promise<void>;
}

/* ────────── Global Immediate Cache ────────── */

interface ImmediateEntry {
  actionType: string;
  payload: any;
  createdAt: number;
}

// taskId → entry[]
// NOTE: використовуємо globalThis singleton для уникнення подвійних копій
// при різних шляхах імпорту (RN Metro static vs dynamic require)
const GLOBAL_KEY = '__VOLUNTEER_IMMEDIATE_PENDING__';
const _immediatePending: Record<string, ImmediateEntry[]> =
  (globalThis as any)[GLOBAL_KEY] || ((globalThis as any)[GLOBAL_KEY] = {});

/**
 * Синхронно додає pending action до глобального кешу.
 * Якщо такий actionType вже є для цього taskId — не дублює (dedup).
 */
export function setPendingActionImmediate(taskId: string, actionType: string, payload: any = {}): void {
  if (!_immediatePending[taskId]) {
    _immediatePending[taskId] = [];
  }
  // Dedup: перевіряємо чи такий actionType вже є
  const exists = _immediatePending[taskId].some(e => e.actionType === actionType);
  if (exists) return;

  _immediatePending[taskId].push({
    actionType,
    payload: { taskId, ...payload },
    createdAt: Date.now(),
  });
  // Сповістити всі hooks
  emitGlobal('pending-actions-changed');
}

/** Перевіряє чи є такий actionType в глобальному immediate-кеші */
export function hasPendingActionImmediate(taskId: string, actionType: string): boolean {
  return !!(_immediatePending[taskId] && _immediatePending[taskId].some(e => e.actionType === actionType));
}

/** Синхронно видаляє pending action з глобального кешу. Якщо silent=true — не сповіщає hooks */
export function removePendingActionImmediate(taskId: string, actionType: string, silent: boolean = false): void {
  if (_immediatePending[taskId]) {
    _immediatePending[taskId] = _immediatePending[taskId].filter(e => e.actionType !== actionType);
    if (!silent) emitGlobal('pending-actions-changed');
  }
}

/* ────────── Helpers ────────── */

/**
 * Очищає глобальний immediate-кеш для taskId.
 * Викликається після успішної синхронізації, щоб прибрати stale pending actions
 * з негайної пам'яті, коли action_queue в БД вже порожній.
 */
export function clearPendingActionsForTask(taskId: string): void {
  if (_immediatePending[taskId]) {
    delete _immediatePending[taskId];
    emitGlobal('pending-actions-changed');
  }
}

function parsePayload(raw: string | null): any {
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/* ────────── Global Event Bus ────────── */
// NOTE: global singleton для уникнення подвійних копій event bus
// при різних шляхах імпорту (RN Metro static vs dynamic require)
const LISTENERS_KEY = '__VOLUNTEER_PENDING_LISTENERS__';
if (!(globalThis as any)[LISTENERS_KEY]) {
  (globalThis as any)[LISTENERS_KEY] = new Map<string, Set<() => void>>();
}
const globalListeners: Map<string, Set<() => void>> = (globalThis as any)[LISTENERS_KEY];

function emitGlobal(event: string) {
  globalListeners.get(event)?.forEach((cb) => cb());
}

function onGlobal(event: string, cb: () => void) {
  if (!globalListeners.has(event)) globalListeners.set(event, new Set());
  globalListeners.get(event)!.add(cb);
  return () => globalListeners.get(event)!.delete(cb);
}

/** Trigger a refresh in ALL usePendingActions hooks across the app */
export function refreshAllPendingActions() {
  emitGlobal('pending-actions-changed');
}

async function findLocalTask(taskId: string) {
  const tasks = await collections.tasks.query().fetch();
  return tasks.find((task: any) => task.serverId === taskId || task.id === taskId);
}

async function findLocalAssignment(taskId: string, userId: string) {
  const assignments = await collections.taskAssignments.query().fetch();
  return assignments.find((assignment: any) => assignment.taskId === taskId && assignment.userId === userId);
}

async function recalculateTaskAssignmentState(task: any, taskId: string, pendingAction: string | null) {
  const assignments = await collections.taskAssignments.query().fetch();
  const taskAssignments = (assignments as any[]).filter((assignment: any) => assignment.taskId === taskId);
  const nextCount = countActiveAssignments(taskAssignments);

  await task.update((record: any) => {
    record.assignedCount = nextCount;
    record.status = nextCount > 0 ? TaskStatus.IN_PROGRESS : TaskStatus.TODO;
    record.isSynced = pendingAction == null;
    record.pendingAction = pendingAction;
    record.lastSyncedAt = pendingAction == null ? Date.now() : null;
  });
}

async function applyLocalTaskAction(
  actionType: string,
  taskId: string,
  userId?: string,
  userName?: string,
  payload: Record<string, unknown> = {},
) {
  const task = await findLocalTask(taskId);

  if (actionType === 'TASK_ASSIGN' && userId) {
    const assignment = await findLocalAssignment(taskId, userId);
    if (assignment) {
      await assignment.update((record: any) => {
        record.status = AssignmentStatus.ASSIGNED;
        record.userName = userName ?? record.userName ?? null;
        record.fulfilledRole = (payload.fulfilledRole as string | undefined) ?? record.fulfilledRole ?? null;
        record.assignedAt = Date.now();
        record.isSynced = false;
        record.pendingAction = 'assign';
        record.lastSyncedAt = null;
      });
    } else {
      await collections.taskAssignments.create((record: any) => {
        record.taskId = taskId;
        record.userId = userId;
        record.userName = userName ?? null;
        record.status = AssignmentStatus.ASSIGNED;
        record.fulfilledRole = (payload.fulfilledRole as string | undefined) ?? null;
        record.assignedAt = Date.now();
        record.isSynced = false;
        record.pendingAction = 'assign';
        record.lastSyncedAt = null;
      });
    }

    if (task) await recalculateTaskAssignmentState(task, taskId, 'assign');
    return;
  }

  if (actionType === 'TASK_WITHDRAW' && userId) {
    const assignment = await findLocalAssignment(taskId, userId);
    if (assignment) {
      await assignment.update((record: any) => {
        record.status = AssignmentStatus.WITHDRAWN;
        record.isSynced = false;
        record.pendingAction = 'withdraw';
        record.lastSyncedAt = null;
      });
    }

    if (task) await recalculateTaskAssignmentState(task, taskId, 'withdraw');
    return;
  }

  if (task && actionType === 'TASK_COMPLETE') {
    await task.update((record: any) => {
      record.status = TaskStatus.PENDING_REVIEW;
      record.isSynced = false;
      record.pendingAction = 'complete';
      record.lastSyncedAt = null;
    });
    return;
  }

  if (task && actionType === 'TASK_RETURN_TO_PROGRESS') {
    await task.update((record: any) => {
      record.status = TaskStatus.IN_PROGRESS;
      record.isSynced = false;
      record.pendingAction = 'return_to_progress';
      record.lastSyncedAt = null;
    });
  }
}

async function revertLocalTaskAction(
  actionType: string,
  taskId: string,
  userId?: string,
) {
  await safeWrite(async () => {
    const task = await findLocalTask(taskId);

    if (actionType === 'TASK_ASSIGN' && userId) {
      const assignment = await findLocalAssignment(taskId, userId);
      if (assignment) {
        await assignment.update((record: any) => {
          record.status = AssignmentStatus.WITHDRAWN;
          record.pendingAction = null;
          record.isSynced = true;
          record.lastSyncedAt = Date.now();
        });
      }
      if (task) await recalculateTaskAssignmentState(task, taskId, null);
      return;
    }

    if (actionType === 'TASK_WITHDRAW' && userId) {
      const assignment = await findLocalAssignment(taskId, userId);
      if (assignment) {
        await assignment.update((record: any) => {
          record.status = AssignmentStatus.ASSIGNED;
          record.pendingAction = null;
          record.isSynced = true;
          record.lastSyncedAt = Date.now();
        });
      }
      if (task) await recalculateTaskAssignmentState(task, taskId, null);
      return;
    }

    if (task && actionType === 'TASK_COMPLETE') {
      await task.update((record: any) => {
        record.status = TaskStatus.IN_PROGRESS;
        record.pendingAction = null;
        record.isSynced = true;
        record.lastSyncedAt = Date.now();
      });
      return;
    }

    if (task && actionType === 'TASK_RETURN_TO_PROGRESS') {
      await task.update((record: any) => {
        record.status = TaskStatus.PENDING_REVIEW;
        record.pendingAction = null;
        record.isSynced = true;
        record.lastSyncedAt = Date.now();
      });
    }
  });
}

/* ────────── Hook ────────── */

export function usePendingActions(taskId: string): PendingActionsInfo {
  const { user } = useAuth();
  const [pendingActions, setPendingActions] = useState<PendingAction[]>(() => {
    // INIT: читаємо з IMMEDIATE cache синхронно — без очікування
    const immediate = _immediatePending[taskId];
    if (immediate && immediate.length > 0) {
      return immediate.map((e, i) => ({
        id: `__imm|${taskId}|${e.actionType}`,
        actionType: e.actionType,
        payload: e.payload,
        createdAt: e.createdAt,
      }));
    }
    return [];
  });
  const refreshingRef = useRef(false);

  const loadPendingActions = useCallback(async () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;

    try {
      const queueItems = (await collections.actionQueue.query().fetch()) as ActionQueueItem[];

      // Build DB-based actions
      const dbActions: PendingAction[] = [];
      for (const item of queueItems) {
        const payload = parsePayload(item.payloadRaw);
        const p: any = payload || {};
        const id = p.taskId || p.task_id || p.id;
        if (id === taskId) {
          dbActions.push({
            id: item.id,
            actionType: item.actionType,
            payload,
            createdAt: item.createdAt,
          });
        }
      }

      // MERGE: DB first (authoritative), then immediate (fill gaps)
      const dbActionTypes = new Set(dbActions.map(a => a.actionType));
      const immediateActions: PendingAction[] = (_immediatePending[taskId] || [])
        .filter(e => !dbActionTypes.has(e.actionType))
        .map((e, i) => ({
          id: `__imm|${taskId}|${e.actionType}`,
          actionType: e.actionType,
          payload: e.payload,
          createdAt: e.createdAt,
        }));

      const merged = [...dbActions, ...immediateActions]
        .sort((a, b) => a.createdAt - b.createdAt);

      if (__DEV__ && merged.length > 0) {
        console.log(`[usePendingActions] taskId=${taskId} | merged=${merged.length} (db=${dbActions.length}, imm=${immediateActions.length})`);
      }
      setPendingActions(merged);
    } catch (e) {
      console.warn('[usePendingActions] load error', e);
    } finally {
      refreshingRef.current = false;
    }
  }, [taskId]);

  const removePendingAction = useCallback(
    async (actionId: string) => {
      // If it's an immediate entry — just remove from global cache
      if (actionId.startsWith('__imm|')) {
        const match = actionId.match(/^__imm\|(.+)\|(.+)$/);
        if (match) {
          const actionType = match[2];
          removePendingActionImmediate(taskId, actionType, true); // silent — we call loadPendingActions ourselves
          await loadPendingActions();
          return;
        }
      }
      // Otherwise — remove from DB inside a Writer
      try {
        const queueItems = (await collections.actionQueue.query().fetch()) as ActionQueueItem[];
        const item = queueItems.find((q) => q.id === actionId);
        if (item) {
          const actionType = item.actionType;
          await safeWrite(async () => {
            await item.destroyPermanently();
          });
          await revertLocalTaskAction(actionType, taskId, user?.id);
          await loadPendingActions();
        }
      } catch (e) {
        console.warn('[usePendingActions] remove error', e);
      }
    },
    [loadPendingActions, taskId, user?.id]
  );

  /** СПІЛЬНА: enqueue offline action (dedup + immediate UI + DB) */
  const enqueueOfflineAction = useCallback(async (actionType: string, payload: any) => {
    // 0. Dedup: if immediate cache already has this actionType, skip duplicate DB write
    if (hasPendingActionImmediate(taskId, actionType)) {
      return;
    }
    // 1. INSTANT UI update — set to global immediate cache (NO DB wait)
    setPendingActionImmediate(taskId, actionType, payload);
    // 2. Build payload with guaranteed taskId
    const mergedPayload = { ...payload, taskId };
    if (!payload || !mergedPayload.taskId) {
      console.warn(`[usePendingActions] enqueueOfflineAction: taskId missing for ${actionType}`, { taskId, payload });
    }
    // 3. Async DB write + optimistic local mutation (only happens once due to dedup guard)
    // IMPORTANT: include taskId in payload so SyncService.push() can find it
    await safeWrite(async () => {
      const queueItems = (await collections.actionQueue.query().fetch()) as ActionQueueItem[];
      const oppositeAction =
        actionType === 'TASK_ASSIGN'
          ? 'TASK_WITHDRAW'
          : actionType === 'TASK_WITHDRAW'
            ? 'TASK_ASSIGN'
            : null;

      for (const item of queueItems) {
        const queuedPayload = parsePayload(item.payloadRaw) || {};
        const queuedTaskId = queuedPayload.taskId || queuedPayload.task_id || queuedPayload.id;
        if (queuedTaskId !== taskId) continue;
        if (item.actionType === actionType || item.actionType === oppositeAction) {
          await item.destroyPermanently();
        }
      }

      await collections.actionQueue.create((aq: any) => {
        aq.actionType = actionType;
        aq.payloadRaw = JSON.stringify(mergedPayload);
        aq.createdAt = Date.now();
        aq.retryCount = 0;
        aq.error = null;
        aq.lastErrorCode = null;
        aq.nextRetryAt = null;
      });

      await applyLocalTaskAction(actionType, taskId, user?.id, user?.fullName, mergedPayload);
    });
    // 4. Notify ALL usePendingActions hooks across the app to refresh
    refreshAllPendingActions();
  }, [taskId, user?.id, user?.fullName]);

  // EAGER: update immediately after local mutations + listen for global events
  useEffect(() => {
    const unsubscribe = onGlobal('pending-actions-changed', () => {
      loadPendingActions();
    });
    const interval = setInterval(() => loadPendingActions(), 3000);
    loadPendingActions(); // initial load from DB
    return () => {
      clearInterval(interval);
      unsubscribe();
    };
  }, [loadPendingActions]);

  const hasAny = pendingActions.length > 0;

  const hasAction = useCallback(
    (actionType?: string): boolean => {
      if (!actionType) return pendingActions.length > 0;
      return pendingActions.some((a) => a.actionType === actionType);
    },
    [pendingActions]
  );

  const getAction = useCallback(
    (actionType: string): PendingAction | undefined => {
      return pendingActions.find((a) => a.actionType === actionType);
    },
    [pendingActions]
  );

  return {
    pendingActions,
    hasAny,
    hasAction,
    getAction,
    removePendingAction,
    refresh: loadPendingActions,
    enqueueOfflineAction,
  };
}
