/**
 * usePendingActions.ts
 * --------------------
 * Hook для відстеження pending actions у action_queue для конкретного taskId.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { collections, database } from '../db/index';
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

/* ────────── Helpers ────────── */

function parsePayload(raw: string | null): any {
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/* ────────── Global Event Bus ────────── */
// Simple global event emitter for cross-hook communication
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
  const [pendingActions, setPendingActions] = useState<PendingAction[]>([]);
  const refreshingRef = useRef(false);

  const loadPendingActionsRef = useRef<(() => Promise<void>) | null>(null);

  const loadPendingActions = useCallback(async () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;

    try {
      const queueItems = (await collections.actionQueue.query().fetch()) as ActionQueueItem[];

      const actions: PendingAction[] = queueItems
        .map((item) => {
          const payload = parsePayload(item.payloadRaw || (item as any)._raw?.payload);
          // Support both taskId (camelCase) and task_id (snake_case)
          const p: any = payload || {};
          const id = p.taskId || p.task_id || p.id;
          return id === taskId
            ? {
                id: item.id,
                actionType: item.actionType,
                payload,
                createdAt: item.createdAt,
              }
            : null;
        })
        .filter((a): a is PendingAction => a !== null)
        .sort((a, b) => a.createdAt - b.createdAt);

      setPendingActions(actions);
    } catch (e) {
      console.warn('[usePendingActions] load error', e);
    } finally {
      refreshingRef.current = false;
    }
  }, [taskId]);
  
  // Store in ref for cleanup
  loadPendingActionsRef.current = loadPendingActions;

  const removePendingAction = useCallback(
    async (actionId: string) => {
      try {
        const queueItems = (await collections.actionQueue.query().fetch()) as ActionQueueItem[];
        const item = queueItems.find((q) => q.id === actionId);
        if (item) {
          await database.write(async () => {
            await item.destroyPermanently();
          });
          await loadPendingActions();
        }
      } catch (e) {
        console.warn('[usePendingActions] remove error', e);
      }
    },
    [loadPendingActions]
  );

  // EAGER: update immediately after local mutations + listen for global events
  useEffect(() => {
    const unsubscribe = onGlobal('pending-actions-changed', () => {
      loadPendingActions();
    });
    loadPendingActions(); // initial
    return () => {
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
