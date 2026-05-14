/**
 * TaskDetailScreen.tsx
 *
 * Основні зміни (offline-first):
 * 1. Added `usePendingActions` hook to track pending action_queue items.
 * 2. Replaced `handleAssign`, `handleComplete`, `handleReturnToProgress`
 *    with `handleAction` helper that enqueues actions when offline.
 * 3. Shows a pending action card (with cancel option) instead of the original
 *    button when a matching action is in the local queue.
 *
 * Pending action labels:
 *   TASK_ASSIGN                — "🕒 Призначити себе (в очікуванні)"
 *   TASK_WITHDRAW              — "🕒 Скасувати призначення (в очікуванні)"
 *   TASK_COMPLETE              — "🕒 Завершити задачу (в очікуванні)"
 *   TASK_RETURN_TO_PROGRESS    — "🕒 Скасувати перевірку (в очікуванні)"
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Alert, StyleSheet, Modal, FlatList, ActivityIndicator,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { tasksApi } from '../../api/tasks.api';
import { orgsApi } from '../../api/orgs.api';
import { API_BASE_URL } from '../../api/axios';
import { Task, TaskStatus, AssignmentStatus, SystemRole, Organization } from '../../types';
import { Colors, statusColors } from '../../utils/theme';
import { Badge, Card, Button, LoadingScreen, ScreenHeader, Input, ProgressBar } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { useNetwork } from '../../context/NetworkContext';
import { OfflineLogger } from '../../utils/offlineLogger';
import { collections, database } from '../../db/index';
import { DBLock } from '../../db/DBLock';
import { TaskReportModal } from '../../components/TaskReportModal';
import { fileUtils } from '../../utils/fileUtils';
import { MediaViewer } from '../../components/MediaViewer';
import { usePendingActions, refreshAllPendingActions, setPendingActionImmediate, removePendingActionImmediate, hasPendingActionImmediate } from '../../hooks/usePendingActions';

/* ─────────────── Types ─────────────── */

type RouteParams = { TaskDetail: { taskId: string; requestId?: string; requestTitle?: string; editMode?: boolean } };

function buildFileUrl(relativePath: string): string {
  const base = API_BASE_URL.replace(/\/api\/?$/, '');
  return `${base}${relativePath}`;
}

/* ─────────────── Component ─────────────── */

export default function TaskDetailScreen() {
  const navigation: any = useNavigation();
  const route = useRoute<RouteProp<RouteParams, 'TaskDetail'>>();
  const { taskId, requestId, requestTitle } = route.params;
  const { user } = useAuth();

  const isNew = taskId === '__new__';
  const [isEditing, setIsEditing] = useState(route.params?.editMode || false);

  const [task, setTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(!isNew);
  const [actioning, setActioning] = useState(false);
  const [showDelegateModal, setShowDelegateModal] = useState(false);
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [delegating, setDelegating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newPeople, setNewPeople] = useState('1');
  const [newRoles, setNewRoles] = useState('');
  const [creating, setCreating] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [reports, setReports] = useState<any[]>([]);
  const [mediaViewerVisible, setMediaViewerVisible] = useState(false);
  const [selectedMedia, setSelectedMedia] = useState<{ url: string; type: 'image' | 'video' }>({ url: '', type: 'image' });

  const { isOffline } = useNetwork();

  /* --- pending actions hook (uses shared enqueueOfflineAction) --- */
  const { pendingActions, hasAction: hasPendingAction, removePendingAction, refresh: refreshPendingActions, enqueueOfflineAction } = usePendingActions(taskId);

  /* ─── Load task from local DB ───────────────────────────────────────────── */
  const loadTaskLocal = useCallback(async (): Promise<Task | null> => {
    try {
      const localTasks = await collections.tasks.query().fetch();
      const local = localTasks.find((t: any) => t.serverId === taskId || t.id === taskId);
      if (!local) return null;

      const localAssignments = await collections.taskAssignments.query().fetch();
      const taskAssignmentsMap = new Map<string, any>();
      localAssignments
        .filter((a: any) => a.taskId === (local as any).serverId || a.taskId === local.id)
        .forEach((a: any) => {
          if (!taskAssignmentsMap.has(a.userId)) {
            taskAssignmentsMap.set(a.userId, {
              id: a.id, taskId: a.taskId, userId: a.userId,
              user: { fullName: a.userName || 'Користувач' }, status: a.status,
              fulfilledRole: a.fulfilledRole,
              assignedAt: a.assignedAt ? new Date(a.assignedAt).toISOString() : '',
            });
          }
        });
      const taskAssignments = Array.from(taskAssignmentsMap.values());

      return {
        id: (local as any).serverId || local.id,
        requestId: (local as any).requestId || (local as any).requestServerId,
        title: (local as any).title, description: (local as any).description, status: (local as any).status,
        neededPeopleCount: (local as any).neededPeopleCount,
        requiredRoles: (local as any).requiredRoles || [],
        assignedCount: (local as any).assignedCount, priority: (local as any).priority,
        deadline: (local as any).deadline ? new Date((local as any).deadline).toISOString() : undefined,
        chatId: (local as any).chatId,
        assignments: taskAssignments,
        createdAt: (local as any).createdAtServer ? new Date((local as any).createdAtServer).toISOString() : '',
      } as Task;
    } catch (e) {
      OfflineLogger.cache('TaskDetail: local load failed', e);
      return null;
    }
  }, [taskId]);

  /* ─── Helper: retry database.write на Diagnostic error ─────────────────── */
  // Паузи: 200ms, 500ms, 1000ms, 2000ms, 4000ms
  const DB_WRITE_RETRY_DELAYS = [200, 500, 1000, 2000, 4000];
  const databaseWriteRetry = async (writeFn: () => Promise<void>, maxRetries: number = 5): Promise<void> => {
    let lastError: any = null;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        await DBLock.withLock(async () => {
          await database.write(writeFn);
        });
        return;
      } catch (err: any) {
        lastError = err;
        const delay = DB_WRITE_RETRY_DELAYS[attempt] || 5000;
        if (err?.name === 'Diagnostic error' || String(err?.message || '').includes('Diagnostic')) {
          OfflineLogger.cache(`TaskDetail: DB write retry ${attempt + 1}/${maxRetries} after Diagnostic error (wait ${delay}ms)`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        throw err;
      }
    }
    DBLock.reset();
    throw lastError;
  };

  /* ─── Save task to local DB ─────────────────────────────────────────────── */
  const saveTaskToDB = useCallback(async (t: Task) => {
    try {
      const existing = await collections.tasks.query().fetch();
      const existingTask = existing.find((et: any) => et.serverId === t.id);
      if (existingTask) {
        await databaseWriteRetry(async () => {
          await existingTask.update((et: any) => {
            et.title = t.title;
            et.description = t.description ?? null;
            et.status = t.status;
            et.neededPeopleCount = t.neededPeopleCount;
            et.requiredRolesRaw = JSON.stringify(t.requiredRoles ?? []);
            et.assignedCount = t.assignments?.filter((a: any) => a.status !== 'withdrawn').length ?? 0;
            et.priority = t.priority ?? 0;
            et.deadline = t.deadline ? new Date(t.deadline).getTime() : null;
            et.chatId = t.chatId ?? null;
            et.isSynced = true;
            et.lastSyncedAt = Date.now();
          });
        });
      } else {
        await databaseWriteRetry(async () => {
          await collections.tasks.create((et: any) => {
            et.serverId = t.id; et.requestServerId = t.requestId; et.title = t.title;
            et.description = t.description ?? null; et.status = t.status;
            et.neededPeopleCount = t.neededPeopleCount ?? 1;
            et.requiredRolesRaw = JSON.stringify(t.requiredRoles ?? []);
            et.assignedCount = t.assignments?.filter((a: any) => a.status !== 'withdrawn').length ?? 0;
            et.priority = t.priority ?? 0;
            et.deadline = t.deadline ? new Date(t.deadline).getTime() : null;
            et.chatId = t.chatId ?? null; et.isSynced = true; et.lastSyncedAt = Date.now();
          });
        });
      }
      if (t.assignments && t.assignments.length > 0) {
        const existingAssignments = await collections.taskAssignments.query().fetch();
        const existingMap = new Map(existingAssignments.map((a: any) => [a.id, a]));
        const ops: any[] = [];
        for (const a of t.assignments) {
          const existingA = existingMap.get(a.id);
          if (existingA) {
            ops.push(existingA.prepareUpdate((ea: any) => {
              ea.status = a.status; ea.userName = a.user?.fullName ?? null; ea.fulfilledRole = a.fulfilledRole ?? null;
            }));
          } else {
            ops.push(collections.taskAssignments.prepareCreate((ea: any) => {
              ea.taskId = a.taskId || taskId; ea.userId = a.userId;
              ea.userName = a.user?.fullName ?? null; ea.status = a.status; ea.fulfilledRole = a.fulfilledRole ?? null;
              ea.assignedAt = a.assignedAt ? new Date(a.assignedAt).getTime() : Date.now(); ea.isSynced = true;
            }));
          }
        }
        if (ops.length > 0) { await databaseWriteRetry(async () => { await database.batch(...ops); }); }
      }
      OfflineLogger.cache(`TaskDetail: saved task ${t.id} to DB`);
    } catch (e) { OfflineLogger.cache('TaskDetail: save to DB failed', e); }
  }, [taskId]);

  /* ─── Load reports ────────────────────────────────────────── */
  const loadReportsLocal = useCallback(async (taskId: string): Promise<any[]> => {
    try {
      const localReports = await collections.taskReports.query().fetch();
      return localReports.filter((r: any) => r.taskId === taskId).map((r: any) => ({
        id: r.serverId || r.id, taskId: r.taskId, userId: r.userId,
        user: { fullName: r.userName || 'Користувач' }, comment: r.comment,
        attachments: r.attachments || [], createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : '',
      }));
    } catch (e) { return []; }
  }, []);

  const saveReportsToDB = useCallback(async (taskId: string, reportsData: any[]) => {
    try {
      const existing = await collections.taskReports.query().fetch();
      const existingMap = new Map(existing.map((r: any) => [r.serverId, r]));
      const ops: any[] = [];
      for (const r of reportsData) {
        const existingR = existingMap.get(r.id);
        if (existingR) {
          ops.push(existingR.prepareUpdate((er: any) => { er.taskId = r.taskId; er.userId = r.userId; er.userName = r.user?.fullName ?? null; er.comment = r.comment; er.attachmentsRaw = JSON.stringify(r.attachments ?? []); er.createdAt = r.createdAt ? new Date(r.createdAt).getTime() : Date.now(); er.lastSyncedAt = Date.now(); }));
        } else {
          ops.push(collections.taskReports.prepareCreate((er: any) => { er.serverId = r.id; er.taskId = r.taskId; er.userId = r.userId; er.userName = r.user?.fullName ?? null; er.comment = r.comment; er.attachmentsRaw = JSON.stringify(r.attachments ?? []); er.createdAt = r.createdAt ? new Date(r.createdAt).getTime() : Date.now(); er.isSynced = true; er.lastSyncedAt = Date.now(); }));
        }
      }
      if (ops.length > 0) { await database.write(async () => { await database.batch(...ops); }); }
    } catch (e) { OfflineLogger.cache('TaskDetail: save reports to DB failed', e); }
  }, []);

  /* ─── Main load ───────────────────────────────────────────────────────── */
  const load = useCallback(async () => {
    if (isNew) return;
    try {
      const timeout = isOffline ? 2000 : 300;
      const localTask = await Promise.race([loadTaskLocal(), new Promise<null>((resolve) => setTimeout(() => resolve(null), timeout))]);
      if (localTask) { setTask(localTask); if (route.params?.editMode) { setNewTitle(localTask.title); setNewDesc(localTask.description || ''); setNewPeople(String(localTask.neededPeopleCount || 1)); setNewRoles(localTask.requiredRoles?.join(', ') || ''); } setLoading(false); }
      const localReports = await loadReportsLocal(taskId);
      if (localReports.length > 0) setReports(localReports);
      if (!isOffline) {
        try {
          const t = await tasksApi.getOne(taskId);
          if (t.assignments && !t.assignedCount) { t.assignedCount = t.assignments.filter((a: any) => a.status !== 'withdrawn').length; }
          setTask(t);
          if (route.params?.editMode) { setNewTitle(t.title); setNewDesc(t.description || ''); setNewPeople(String(t.neededPeopleCount || 1)); setNewRoles(t.requiredRoles?.join(', ') || ''); }
          await saveTaskToDB(t);
          try { const { taskReportsApi } = await import('../../api/task-reports.api'); const reps = await taskReportsApi.getAll(taskId); setReports(reps); await saveReportsToDB(taskId, reps); } catch {}
        } catch (e) { OfflineLogger.network('TaskDetail: server load failed'); if (!localTask) { Alert.alert('Помилка', 'Не вдалося завантажити підзадачу'); if (navigation.canGoBack()) navigation.goBack(); } }
      }
    } catch (e) { OfflineLogger.nav('TaskDetail: unexpected error', e); } finally { setLoading(false); }
  }, [taskId, isNew, isOffline, loadTaskLocal, saveTaskToDB, loadReportsLocal, saveReportsToDB, navigation]);

  useEffect(() => { load(); }, [load]);

  /* enqueueOfflineAction тепер з usePendingActions hook (shared) */

  const getActionTypeForAssign = (isMe: boolean) => isMe ? 'TASK_WITHDRAW' : 'TASK_ASSIGN';

  /* ─── handleAssign ─────────────────────────────────────────────────────── */
  const handleAssign = async () => {
    if (!task) return;
    const isMe = task.assignments?.some(a => a.userId === user?.id && a.status !== 'withdrawn');
    const actionType = getActionTypeForAssign(!!isMe);

    if (isOffline) {
      Alert.alert(
        '📴 Офлайн режим',
        isMe ? 'Скасувати призначення офлайн?' : 'Призначити себе офлайн?',
        [
          { text: 'Ні', style: 'cancel' },
          {
            text: 'Так',
            onPress: async () => {
              await enqueueOfflineAction(actionType, { taskId: task.id, fulfilledRole: null });
              Alert.alert('✅ Збережено', 'Дія поставлена в чергу синхронізації');
            }
          }
        ]
      );
      return;
    }

    if (isMe) {
      // Withdraw — ask confirmation first
      Alert.alert('Відмовитися від задачі?', 'Ви впевнені, що хочете відмовитися?', [
        { text: 'Ні', style: 'cancel' },
        { text: 'Так, відмовитися', style: 'destructive', onPress: async () => {
          setActioning(true);
          try {
            await tasksApi.withdraw(task.id);
            await database.write(async () => {
              const allTasks = await collections.tasks.query().fetch();
              const localTask = allTasks.find((t: any) => t.serverId === task.id || t.id === task.id);
              if (localTask) {
                await localTask.update((t: any) => {
                  t.status = TaskStatus.TODO;
                  t.assignedCount = Math.max(Number((t as any).assignedCount || 0) - 1, 0);
                  t.isSynced = true; t.pendingAction = null; t.lastSyncedAt = Date.now();
                });
              }
              const localAssignments = (await collections.taskAssignments.query().fetch()) as any[];
              const myAssignment = localAssignments.find((a: any) => a.taskId === task.id && a.userId === user?.id);
              if (myAssignment && myAssignment.status !== 'withdrawn') {
                await myAssignment.update((a: any) => { a.status = AssignmentStatus.WITHDRAWN; a.isSynced = true; a.pendingAction = null; a.lastSyncedAt = Date.now(); });
              }
            });
            await load();
          } catch (e: any) {
            // Diagnostic error = local DB race, API call succeeded — не ставити в чергу
            if (e?.name === 'Diagnostic error' || String(e?.message || '').includes('Diagnostic')) {
              OfflineLogger.cache('TaskDetail: withdraw DB write failed after retries, but API succeeded');
              await load();
              return;
            }
            const isNetworkError = !e.response || e.code === 'ERR_NETWORK' || e.message === 'Network Error';
            if (isNetworkError) {
              await enqueueOfflineAction('TASK_WITHDRAW', { taskId: task.id });
              await load();
              Alert.alert('📴 Офлайн', 'Мережа зникла. Відмову поставлено в чергу синхронізації');
            } else {
              Alert.alert('Помилка', e?.response?.data?.message ?? 'Спробуйте ще раз');
            }
          } finally { setActioning(false); }
        }},
      ]);
    } else {
      // Assign
      setActioning(true);
      try {
        await tasksApi.assign(task.id);
        await database.write(async () => {
          const allTasks = await collections.tasks.query().fetch();
          const localTask = allTasks.find((t: any) => t.serverId === task.id || t.id === task.id);
          if (localTask) {
            await localTask.update((t: any) => {
              t.status = TaskStatus.IN_PROGRESS;
              t.assignedCount = Number((t as any).assignedCount || 0) + 1;
              t.isSynced = true; t.pendingAction = null; t.lastSyncedAt = Date.now();
            });
          }
          const localAssignments = (await collections.taskAssignments.query().fetch()) as any[];
          const existing = localAssignments.find((a: any) => a.taskId === task.id && a.userId === user?.id);
          if (existing) {
            await existing.update((a: any) => { a.status = AssignmentStatus.ASSIGNED; a.isSynced = true; a.pendingAction = null; a.lastSyncedAt = Date.now(); });
          } else {
            await collections.taskAssignments.create((a: any) => { a.taskId = task.id; a.userId = user?.id || ''; a.status = AssignmentStatus.ASSIGNED; a.isSynced = true; a.pendingAction = null; a.lastSyncedAt = Date.now(); });
          }
        });
        await load();
          } catch (e: any) {
            // Diagnostic error = local DB race, API call succeeded — не ставити в чергу
            if (e?.name === 'Diagnostic error' || String(e?.message || '').includes('Diagnostic')) {
              OfflineLogger.cache('TaskDetail: assign DB write failed after retries, but API succeeded');
              await load();
              return;
            }
            const isNetworkError = !e.response || e.code === 'ERR_NETWORK' || e.message === 'Network Error';
            if (isNetworkError) {
              await enqueueOfflineAction('TASK_ASSIGN', { taskId: task.id, fulfilledRole: null });
              await load();
              Alert.alert('📴 Офлайн', 'Мережа зникла. Призначення поставлено в чергу синхронізації');
            } else {
              Alert.alert('Помилка', e?.response?.data?.message ?? 'Спробуйте ще раз');
            }
          } finally { setActioning(false); }
    }
  };

  /* ─── handleComplete ──────────────────────────────────────────────────── */
  const handleComplete = async () => {
    if (!task) return;
    if (isOffline) { 
      Alert.alert('📴 Офлайн режим', 'Завершити задачу офлайн?', [
        { text: 'Ні', style: 'cancel' },
        { text: 'Так', onPress: async () => { 
          await enqueueOfflineAction('TASK_COMPLETE', { taskId: task.id }); 
          Alert.alert('✅ Збережено', 'Завершення поставлено в чергу синхронізації');
        }}
      ]);
      return; 
    }
    Alert.alert('Завершити задачу?', 'Статус буде змінено на «На перевірці»', [
      { text: 'Ні' },
      {
        text: 'Так, завершити', onPress: async () => {
          try { setActioning(true); await tasksApi.complete(task.id); await load(); Alert.alert('✓ Завершено', 'Бажаєте додати звіт про виконану роботу (фото, коментар)?', [{ text: 'Ні, дякую' }, { text: 'Так, додати', onPress: () => setShowReportModal(true) }]); }
          catch (e: any) { Alert.alert('Помилка', e?.response?.data?.message ?? 'Не вдалося оновити статус'); } finally { setActioning(false); }
        },
      },
    ]);
  };

  /* ─── handleReturnToProgress ──────────────────────────────────────────── */
  const handleReturnToProgress = async () => {
    if (!task) return;
    if (isOffline) { await enqueueOfflineAction('TASK_RETURN_TO_PROGRESS', { taskId: task.id }); return; }
    Alert.alert('Скасувати перевірку?', 'Задача буде повернута в роботу', [
      { text: 'Ні' },
      {
        text: 'Так, повернути', onPress: async () => {
          try { setActioning(true); await tasksApi.returnToProgress(task.id); await load(); }
          catch (e: any) { Alert.alert('Помилка', e?.response?.data?.message ?? 'Не вдалося повернути задачу в роботу'); } finally { setActioning(false); }
        },
      },
    ]);
  };

  /* ─── Generic pending action UI ─────────────────────────────────────────── */
  const renderPendingAction = (actionType: string, label: string, variant: 'primary' | 'danger' | 'outline' = 'primary') => {
    const pending = pendingActions.find(a => a.actionType === actionType);
    if (!pending) return null;
    return (
      <View key={actionType} style={[styles.pendingContainer, { borderColor: variant === 'danger' ? Colors.danger : Colors.primary }]}>
        <View style={styles.pendingRow}>
          <Text style={styles.pendingText}>🕒 {label}</Text>
          <TouchableOpacity onPress={async () => { await removePendingAction(pending.id); Alert.alert('Скасовано', 'Дію видалено з черги'); }} style={styles.cancelBtn}>
            <Text style={styles.cancelText}>Скасувати</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  /* ─── Rest of handlers (unchanged) ────────────────────────────────────── */

  const handleCreate = async () => {
    if (!newTitle.trim() || newTitle.trim().length < 3) { Alert.alert('', 'Назва — мін. 3 символи'); return; }
    if (!requestId) return;
    setCreating(true);
    try {
      await tasksApi.create(requestId, { title: newTitle.trim(), description: newDesc.trim() || undefined, neededPeopleCount: parseInt(newPeople) || 1, requiredRoles: newRoles.split(',').map(r => r.trim()).filter(Boolean) });
      if (navigation.canGoBack()) navigation.goBack(); else navigation.navigate('RequestsList' as never);
    } catch (e: any) { Alert.alert('Помилка', e?.response?.data?.message ?? 'Щось пішло не так'); } finally { setCreating(false); }
  };

  const handleUpdate = async () => {
    if (!newTitle.trim() || newTitle.trim().length < 3) { Alert.alert('', 'Назва — мін. 3 символи'); return; }
    setCreating(true);
    try { await tasksApi.update(taskId, { title: newTitle.trim(), description: newDesc.trim() || undefined, neededPeopleCount: parseInt(newPeople) || 1, requiredRoles: newRoles.split(',').map(r => r.trim()).filter(Boolean) }); setIsEditing(false); load(); }
    catch (e: any) { Alert.alert('Помилка', e?.response?.data?.message ?? 'Щось пішло не так'); } finally { setCreating(false); }
  };

  const handleAddReport = () => { setShowReportModal(true); };

  const handleReportSubmit = async (comment: string, attachments: { uri: string; name: string; type: string }[]) => {
    if (!task) return;
    setUploading(true);
    try { const { taskReportsApi } = await import('../../api/task-reports.api'); await taskReportsApi.create(task.id, comment, attachments); setShowReportModal(false); const updated = await taskReportsApi.getAll(task.id); setReports(updated); }
    catch (e: any) { Alert.alert('Помилка', e?.response?.data?.message ?? 'Не вдалося надіслати звіт'); } finally { setUploading(false); }
  };

  const handleConfirm = async () => {
    if (!task) return;
    Alert.alert('✓ Підтвердити виконання', `Задачу буде вважати виконаною`, [
      { text: 'Ні' },
      { text: 'Так, підтвердити', onPress: async () => { try { setActioning(true); await tasksApi.confirm(task.id); await load(); } catch (e: any) { Alert.alert('Помилка', e?.response?.data?.message ?? ''); } finally { setActioning(false); } } },
    ]);
  };

  const handleReject = async () => {
    if (!task) return;
    Alert.alert('✗ Відхилити', `Відмовити в підтвердженні, повернути в роботу`, [
      { text: 'Ні' },
      { text: 'Так, відхилити', onPress: async () => { try { setActioning(true); await tasksApi.reject(task.id); await load(); } catch (e: any) { Alert.alert('Помилка', e?.response?.data?.message ?? ''); } finally { setActioning(false); } } },
    ]);
  };

  const handleDelegateOpen = async () => { try { const data = await orgsApi.getAll(); setOrgs(data); setShowDelegateModal(true); } catch { Alert.alert('Помилка', 'Не вдалося завантажити список організацій'); } };

  const handleDelegate = async (orgId: string, orgName: string) => {
    if (!task) return;
    setDelegating(true);
    try { await tasksApi.delegate(task.id, orgId); setShowDelegateModal(false); Alert.alert('✓', `Задачу делеговано організації "${orgName}"`); await load(); }
    catch (e: any) { Alert.alert('Помилка', e?.response?.data?.message ?? ''); } finally { setDelegating(false); }
  };

  const handleUpdateStatus = (newStatus: AssignmentStatus) => {
    if (!task) return;
    const labels: Record<string, string> = { assigned: 'Призначено', applied: 'Подано заявку', accepted: 'Прийнято', rejected: 'Відхилено', withdrawn: 'Відкликав', completed: 'Виконав', en_route: 'В дорозі', on_site: 'На місці' };
    Alert.alert('Оновити статус?', labels[newStatus] ?? newStatus, [
      { text: 'Ні' },
      { text: 'Так', onPress: async () => { try { setActioning(true); await tasksApi.updateAssignmentStatus(task.id, newStatus); await load(); } catch (e: any) { Alert.alert('Помилка', e?.response?.data?.message ?? ''); } finally { setActioning(false); } } },
    ]);
  };

  const handleOpenAttachment = async (a: { url: string; name: string; type: string }) => {
    const absoluteUrl = buildFileUrl(a.url);
    if (a.type?.startsWith('image/')) { fileUtils.previewImage(absoluteUrl); } else { fileUtils.downloadAndOpenFile(absoluteUrl, a.name, a.type); }
  };

  /* ─── Render helpers ─────────────────────────────────────────────────────── */

  if (isNew || isEditing) {
    return (
      <View style={{ flex: 1 }}>
        <ScreenHeader title={isEditing ? "Редагувати задачу" : "Створити задачу"} onBack={() => isEditing ? setIsEditing(false) : navigation.goBack()} />
        <ScrollView contentContainerStyle={{ padding: 16 }}>
          <Input label="Назва задачі" value={newTitle} onChangeText={setNewTitle} />
          <Input label="Опис" value={newDesc} onChangeText={setNewDesc} multiline />
          <Input label="Потрібно людей" value={newPeople} onChangeText={setNewPeople} keyboardType="numeric" />
          <Input label="Потрібні ролі (через кому)" value={newRoles} onChangeText={setNewRoles} multiline />
          <Button title={isEditing ? "Зберегти" : "Створити"} onPress={isEditing ? handleUpdate : handleCreate} loading={creating} style={{ marginTop: 12 }} />
          <Button title="Скасувати" variant="ghost" onPress={() => isEditing ? setIsEditing(false) : navigation.goBack()} style={{ marginTop: 8 }} />
        </ScrollView>
      </View>
    );
  }

  if (loading) return <LoadingScreen />;
  if (!task) return null;

  const activeAssignments = task.assignments?.filter(a => a.status !== AssignmentStatus.WITHDRAWN) ?? [];
  const isMe = task.assignments?.some(a => a.userId === user?.id && a.status !== 'withdrawn');
  const myAssignment = task.assignments?.find(a => a.userId === user?.id && a.status !== 'withdrawn');
  const isAdmin = user?.systemRole === SystemRole.ADMIN;
  const isCoord = user?.systemRole === SystemRole.COORDINATOR;
  const isVolunteerOrCoord = user?.systemRole === SystemRole.VOLUNTEER || user?.systemRole === SystemRole.COORDINATOR;
  const isOwner = user?.id === (task as any).request?.creatorId;
  const isCoordOrAdmin = isCoord || isAdmin || isOwner;
  const isParticipant = activeAssignments.some(a => a.userId === user?.id);

  const statusLabels: Record<string, string> = { en_route: 'В дорозі', on_site: 'На місці', accepted: 'Прийнято', rejected: 'Відхилено', withdrawn: 'Відкликав', completed: 'Виконано', applied: 'Подано' };
  const canReport = isMe && (task.status === TaskStatus.IN_PROGRESS || task.status === TaskStatus.PENDING_REVIEW);

  /* ─── Pending action types for this task ───────────────────────────────── */
  const pendingAssign = hasPendingAction('TASK_ASSIGN') || hasPendingAction('TASK_WITHDRAW');
  const pendingComplete = hasPendingAction('TASK_COMPLETE');
  const pendingReturn = hasPendingAction('TASK_RETURN_TO_PROGRESS');

  return (
    <View style={{ flex: 1 }}>
      <ScreenHeader title={requestTitle ? `${requestTitle} / Задача` : task?.title || 'Задача'} onBack={() => navigation.goBack()} />

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        {/* Meta card */}
        <Card style={{ padding: 16, marginBottom: 12 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
            <Text style={{ flex: 1, fontSize: 18, fontWeight: '700', color: Colors.text }}>{task.title}</Text>
            <Badge label={statusColors[task.status]?.label ?? task.status} colorScheme="status" value={task.status} size="md" />
          </View>
          {task.description && <Text style={{ fontSize: 14, color: Colors.textSecondary, lineHeight: 20 }}>{task.description}</Text>}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
            {task.requiredRoles?.filter(Boolean).length > 0 && <Text style={{ fontSize: 13, color: Colors.textSecondary, fontWeight: '600' }}>🎭 {task.requiredRoles.filter(Boolean).join(', ')}</Text>}
            {!!task.deadline && <Text style={{ fontSize: 13, color: Colors.warning, fontWeight: '600' }}>⏰ {new Date(task.deadline).toLocaleDateString('uk-UA', { day: 'numeric', month: 'long' })}</Text>}
          </View>
        </Card>

        {/* Progress bar */}
        {Number(task.neededPeopleCount) > 1 && (
          <Card style={{ padding: 16, marginBottom: 12 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
              <Text style={{ fontSize: 14, fontWeight: '600', color: Colors.textSecondary }}>Виконавці</Text>
              <Text style={{ fontSize: 14, fontWeight: '700', color: Colors.text }}>{`${task.assignedCount ?? 0}/${task.neededPeopleCount ?? 0}`}</Text>
            </View>
            <ProgressBar value={task.assignedCount ?? 0} total={task.neededPeopleCount ?? 1} />
          </Card>
        )}

        {/* Assignees list */}
        {activeAssignments.length > 0 && (
          <Card style={{ padding: 16, marginBottom: 12 }}>
            <Text style={{ fontSize: 15, fontWeight: '700', marginBottom: 8, color: Colors.text }}>Виконавці ({activeAssignments.length})</Text>
            <FlatList data={activeAssignments} scrollEnabled={false} keyExtractor={a => a.userId} renderItem={({ item: a }) => (
              <TouchableOpacity onPress={() => a.userId && navigation.navigate('UserProfile', { userId: a.userId })} activeOpacity={0.7}>
                <View style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: Colors.borderLight }}>
                  <Text style={{ fontSize: 15, fontWeight: '600', color: Colors.text }}>{a.user?.fullName || 'Користувач'}</Text>
                  <Text style={{ fontSize: 13, color: Colors.textSecondary }}>Статус: {statusLabels[a.status] || a.status || 'Невідомо'}</Text>
                </View>
              </TouchableOpacity>
            )} />
          </Card>
        )}

        {/* Action buttons */}
        <Card style={{ padding: 16 }}>
          {/* Volunteer: take/withdraw — показуємо pending state якщо є */}
          {isVolunteerOrCoord && (task.status === TaskStatus.TODO || task.status === TaskStatus.IN_PROGRESS) && (
            pendingAssign
              ? renderPendingAction(isMe ? 'TASK_WITHDRAW' : 'TASK_ASSIGN', isMe ? 'Відміна призначення в черзі' : 'Призначення в черзі', isMe ? 'danger' : 'primary')
              : <Button title={isMe ? 'Відмовитися від задачі' : '✋ Взяти в роботу'} variant={isMe ? 'danger' : 'primary'} onPress={handleAssign} loading={actioning} style={{ marginBottom: 10 }} />
          )}

          {/* Status update buttons (EN_ROUTE / ON_SITE) */}
          {isMe && task.status === TaskStatus.IN_PROGRESS && myAssignment && (
            <>
              <Button
                title="🚗 Я в дорозі"
                variant={myAssignment.status === AssignmentStatus.EN_ROUTE ? 'primary' : 'outline'}
                onPress={() => { const targetStatus = AssignmentStatus.EN_ROUTE; const newStatus = myAssignment?.status === targetStatus ? 'assigned' as AssignmentStatus : targetStatus; handleUpdateStatus(newStatus); }}
                loading={actioning} style={{ marginBottom: 8 }} size="sm"
              />
              <Button
                title="📍 Я на місці"
                variant={myAssignment.status === AssignmentStatus.ON_SITE ? 'primary' : 'outline'}
                onPress={() => { const targetStatus = AssignmentStatus.ON_SITE; const newStatus = myAssignment?.status === targetStatus ? 'assigned' as AssignmentStatus : targetStatus; handleUpdateStatus(newStatus); }}
                loading={actioning} style={{ marginBottom: 8 }} size="sm"
              />
            </>
          )}

          {/* Complete task + Add Report */}
          {isMe && task.status === TaskStatus.IN_PROGRESS && (
            <>
              {pendingComplete
                ? renderPendingAction('TASK_COMPLETE', 'Завершення задачі в черзі')
                : <Button title="✅ Позначити як виконану" variant="primary" onPress={handleComplete} loading={actioning} style={{ marginBottom: 8 }} />
              }
              <Button title="📋 Додати звіт" variant="outline" onPress={handleAddReport} style={{ marginBottom: 8 }} />
            </>
          )}

          {isMe && task.status === TaskStatus.PENDING_REVIEW && (
            <>
              {pendingReturn
                ? renderPendingAction('TASK_RETURN_TO_PROGRESS', 'Повернення в роботу в черзі', 'danger')
                : <Button title="↩️ Скасувати перевірку" variant="danger" onPress={handleReturnToProgress} loading={actioning} style={{ marginBottom: 8 }} />
              }
              <Button title="📋 Додати звіт" variant="outline" onPress={handleAddReport} style={{ marginBottom: 8 }} />
            </>
          )}

          {/* Confirm/Reject for coordinators/admins */}
          {isCoordOrAdmin && task.status === TaskStatus.PENDING_REVIEW && (
            <>
              <Button title="✓ Підтвердити виконання" variant="primary" onPress={handleConfirm} loading={actioning} style={{ marginBottom: 8 }} />
              <Button title="✗ Відхилити (повернути в роботу)" variant="outline" onPress={handleReject} style={{ marginBottom: 8 }} />
            </>
          )}

          {/* Delegate */}
          {isCoordOrAdmin && (task.status === TaskStatus.TODO || task.status === TaskStatus.IN_PROGRESS) && (
            <Button title="🏢 Делегувати організації" variant="outline" onPress={handleDelegateOpen} style={{ marginBottom: 8 }} />
          )}

          {/* Chat */}
          {task.chatId && (
            <Button title="💬 Чат завдання" variant="primary" onPress={() => navigation.navigate('Chats', { screen: 'ChatRoom', params: { chatId: task.chatId, chatName: `Чат: ${task.title}` } })} />
          )}

          {/* Edit */}
          {isCoordOrAdmin && task.status === TaskStatus.TODO && (
            <Button title="✏️ Редагувати задачу" variant="outline" onPress={() => { setNewTitle(task.title); setNewDesc(task.description || ''); setNewPeople(String(task.neededPeopleCount || 1)); setNewRoles(task.requiredRoles?.join(', ') || ''); setIsEditing(true); }} style={{ marginTop: 8 }} />
          )}
        </Card>

        {/* Reports history */}
        {reports.length > 0 && (
          <Card style={{ padding: 16, marginTop: 12 }}>
            <Text style={{ fontSize: 15, fontWeight: '700', marginBottom: 12, color: Colors.text }}>Історія звітів ({reports.length})</Text>
            {reports.map((r) => (
              <View key={r.id} style={{ paddingBottom: 12, marginBottom: 12, borderBottomWidth: 1, borderBottomColor: Colors.borderLight }}>
                <Text style={{ fontSize: 13, color: Colors.textSecondary, marginBottom: 4 }}>{new Date(r.createdAt).toLocaleString('uk-UA')} • {r.user?.fullName}</Text>
                <Text style={{ fontSize: 14, color: Colors.text }}>{r.comment}</Text>
                {r.attachments?.length > 0 && (
                  <View style={{ marginTop: 8 }}>
                    {r.attachments.map((a: any, j: number) => {
                      const canViewMedia = isOwner || isCoordOrAdmin || isParticipant;
                      const isHidden = (task as any).request?.isLocationHidden && !canViewMedia;
                      if (isHidden) { return (<View key={j} style={{ padding: 8, backgroundColor: Colors.warningLight, borderRadius: 8, marginTop: 6 }}><Text style={{ fontSize: 13, color: Colors.warning }}>🔒 Медіа приховано (локація захищена)</Text></View>); }
                      return (
                        <TouchableOpacity key={j} onPress={() => { const absoluteUrl = buildFileUrl(a.url); const isImage = a.type?.startsWith('image/'); const isVideo = a.type?.startsWith('video/'); if (isImage || isVideo) { setSelectedMedia({ url: absoluteUrl, type: isImage ? 'image' : 'video' }); setMediaViewerVisible(true); } else { handleOpenAttachment(a); } }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.borderLight, padding: 8, borderRadius: 8, marginTop: 6 }}>
                            <Text>{a.type?.startsWith('image/') ? '🖼️' : '📄'}</Text>
                            <Text style={{ fontSize: 13, color: Colors.text }} numberOfLines={1}>{a.name}</Text>
                          </View>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}
                <View style={{ flexDirection: 'row', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
                  {r.userId === user?.id && (
                    <>
                      <TouchableOpacity onPress={() => Alert.alert('Редагування', 'Редагування поки в процесі розробки')}><Text style={{ color: Colors.primary, fontSize: 12 }}>✏️ Редагувати</Text></TouchableOpacity>
                      <TouchableOpacity onPress={async () => { try { const { reportsApi } = await import('../../api/reports.api'); await reportsApi.delete(task.id, r.id); await load(); } catch (e: any) { Alert.alert('Помилка', e?.response?.data?.message ?? 'Не вдалося видалити'); } }}><Text style={{ color: Colors.danger, fontSize: 12 }}>🗑️ Видалити</Text></TouchableOpacity>
                    </>
                  )}
                  {isCoordOrAdmin && !r.isVerified && (<TouchableOpacity onPress={async () => { try { const { reportsApi } = await import('../../api/reports.api'); await reportsApi.verify(task.id, r.id); await load(); } catch (e: any) { Alert.alert('Помилка', e?.response?.data?.message ?? 'Не вдалося підтвердити'); } }}><Text style={{ color: Colors.success, fontSize: 12 }}>✓ Підтвердити</Text></TouchableOpacity>)}
                  {r.isVerified && <Text style={{ color: Colors.success, fontSize: 12, fontWeight: 'bold' }}>✓ Підтверджено</Text>}
                </View>
              </View>
            ))}
          </Card>
        )}
      </ScrollView>

      {/* Delegate modal */}
      <Modal visible={showDelegateModal} animationType="slide" onRequestClose={() => setShowDelegateModal(false)}>
        <View style={{ flex: 1, backgroundColor: Colors.background }}>
          <ScreenHeader title="Делегувати задачу" onBack={() => setShowDelegateModal(false)} />
          <FlatList data={orgs} keyExtractor={o => o.id} contentContainerStyle={{ padding: 16 }} renderItem={({ item }) => (
            <TouchableOpacity onPress={() => handleDelegate(item.id, item.name)} activeOpacity={0.8}>
              <Card style={{ padding: 12, marginBottom: 8 }}>
                <Text style={{ fontSize: 15, fontWeight: '700', color: Colors.text }}>{item.name}</Text>
                {item.description && <Text style={{ fontSize: 13, color: Colors.textSecondary, marginTop: 3 }}>{item.description}</Text>}
              </Card>
            </TouchableOpacity>
          )} />
        </View>
      </Modal>

      {/* Report modal */}
      <TaskReportModal visible={showReportModal} onClose={() => setShowReportModal(false)} onSubmit={handleReportSubmit} loading={uploading} />

      {/* Media Viewer */}
      <MediaViewer visible={mediaViewerVisible} url={selectedMedia.url} type={selectedMedia.type} onClose={() => setMediaViewerVisible(false)} />
    </View>
  );
}

/* ─────────────── Styles ─────────────── */

const styles = StyleSheet.create({
  sectionTitle: { fontSize: 15, fontWeight: '700', color: Colors.text, marginBottom: 8 },
  pendingContainer: {
    padding: 12,
    borderRadius: 8,
    marginBottom: 10,
    borderWidth: 1.5,
    backgroundColor: '#FFF8E1',
  },
  pendingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pendingText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#F57C00',
    flex: 1,
    flexWrap: 'wrap',
  },
  cancelBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.7)',
  },
  cancelText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#E65100',
  },
});
