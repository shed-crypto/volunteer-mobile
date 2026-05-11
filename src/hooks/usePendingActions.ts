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
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { collections } from '../db/index';
import { ActionQueueItem } from '../db/models/ActionQueueItem';

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
}

/* ────────── Global Immediate Cache ────────── */

interface ImmediateEntry {
  actionType: string;
  payload: any;
  createdAt: number;
}

// taskId → entry[]
const _immediatePending: Record<string, ImmediateEntry[]> = {};

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

function parsePayload(raw: string | null): any {
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/* ────────── Global Event Bus ────────── */
const globalListeners = new Map<string, Set<() => void>>();

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

/* ────────── Hook ────────── */

export function usePendingActions(taskId: string): PendingActionsInfo {
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

      // If DB has data — clear any immediate entries for this task
      if (dbActions.length > 0) {
        delete _immediatePending[taskId];
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
      // Otherwise — remove from DB
      try {
        const queueItems = (await collections.actionQueue.query().fetch()) as ActionQueueItem[];
        const item = queueItems.find((q) => q.id === actionId);
        if (item) {
          await item.destroyPermanently();
          await loadPendingActions();
        }
      } catch (e) {
        console.warn('[usePendingActions] remove error', e);
      }
    },
    [loadPendingActions, taskId]
  );

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
  };
}