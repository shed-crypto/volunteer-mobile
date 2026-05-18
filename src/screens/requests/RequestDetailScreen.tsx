import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Alert, Platform,
  RefreshControl, StyleSheet, Linking, Modal, FlatList, Image,
} from 'react-native';
import * as Location from 'expo-location';
import { useNavigation, useRoute, useFocusEffect, RouteProp } from '@react-navigation/native';
import * as DocumentPicker from 'expo-document-picker';
import { API_BASE_URL, getServerReachable } from '../../api/axios';
import { MediaViewer } from '../../components/MediaViewer';
import { requestsApi } from '../../api/requests.api';
import { tasksApi } from '../../api/tasks.api';
import { SyncService } from '../../db/SyncService';
import { Request, Task, TaskStatus, SystemRole, RequestStatus, AssignmentStatus } from '../../types';
import {
  Colors, urgencyColors, statusColors,
  categoryLabels, clearanceLabels,
} from '../../utils/theme';
import {
  Badge, Card, Button, EmptyState,
  LoadingScreen, ScreenHeader, ProgressBar,
  Input,
} from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { useNetwork } from '../../context/NetworkContext';
import { OfflineLogger } from '../../utils/offlineLogger';
import { collections, safeWrite } from '../../db/index';
import { database } from '../../db/index';
import { DBLock } from '../../db/DBLock';
import { usePendingActions, refreshAllPendingActions, setPendingActionImmediate, removePendingActionImmediate, hasPendingActionImmediate } from '../../hooks/usePendingActions';
import { countActiveAssignments } from '../../db/helpers/assignments';

type RouteParams = { RequestDetail: { requestId: string } };

function getMimeType(url: string): string {
  if (!url) return 'application/octet-stream';
  const ext = url.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'mp4':
      return 'video/mp4';
    case 'mov':
      return 'video/quicktime';
    case 'avi':
      return 'video/x-msvideo';
    default:
      return 'application/octet-stream';
  }
}

const KANBAN_COLS: { status: TaskStatus; label: string; color: string }[] = [
  { status: TaskStatus.TODO,           label: 'До роботи',    color: Colors.textMuted },
  { status: TaskStatus.IN_PROGRESS,    label: 'Виконується',  color: Colors.primary },
  { status: TaskStatus.PENDING_REVIEW, label: 'На перевірці', color: Colors.warning },
  { status: TaskStatus.DONE,           label: 'Готово ✓',     color: Colors.secondary },
];

export default function RequestDetailScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<RouteParams, 'RequestDetail'>>();
  const { requestId } = route.params;
  const { user } = useAuth();

  const [request, setRequest] = useState<Request | null>(null);
  const [tasks, setTasks]     = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isOfflineMode, setIsOfflineMode] = useState(false);
  const { isOffline } = useNetwork();

  const [editingInfoId, setEditingInfoId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');
  const [savingInfo, setSavingInfo] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [bookmarkLoading, setBookmarkLoading] = useState(false);

  // ─── Check saved status from local DB (fallback only) ───────────────────
  const checkSavedLocal = useCallback(async (): Promise<boolean> => {
    try {
      const saved = await collections.savedRequests.query().fetch();
      return saved.some((s: any) => String(s.requestId) === String(requestId));
    } catch (e) {
      OfflineLogger.cache('RequestDetail: Failed to check saved status from local DB', e);
      return false;
    }
  }, [requestId]);
  const [selectedMedia, setSelectedMedia] = useState<{ url: string; type: 'image' | 'video' } | null>(null);
  const [mediaViewerVisible, setMediaViewerVisible] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<Array<{ uri: string; name: string; type: string }>>([]);
  const [isUploading, setIsUploading] = useState(false);
  // Для редагування доповнення: серверні файли з можливістю видалення
  const [existingInfoFiles, setExistingInfoFiles] = useState<Array<{ url: string; name: string; type: string }>>([]);
  const [removedInfoUrls, setRemovedInfoUrls] = useState<string[]>([]);
  const [pendingAddInfoActions, setPendingAddInfoActions] = useState<Array<{ id: string; text: string; createdAt: number; attachmentsCount: number }>>([]);
  const [pendingUpdateActions, setPendingUpdateActions] = useState<Array<{ id: string; expiresAt: number }>>([]);

  // ─── Load tasks from local DB ────────────────────────────────────────────
  const loadTasksLocal = useCallback(async (requestId: string): Promise<Task[]> => {
    try {
      const localTasks = await collections.tasks.query().fetch();
      const requestTasks = localTasks.filter((t: any) => t.requestId === requestId || t.requestServerId === requestId);

      if (requestTasks.length > 0) {
        // Load assignments for these tasks
        const localAssignments = await collections.taskAssignments.query().fetch();
        const taskAssignmentsMap = new Map<string, any[]>();
        localAssignments
          .filter((a: any) => requestTasks.some((t: any) => t.serverId === a.taskId || t.id === a.taskId))
          .forEach((a: any) => {
            const key = a.taskId;
            if (!taskAssignmentsMap.has(key)) taskAssignmentsMap.set(key, []);
            const list = taskAssignmentsMap.get(key)!;
            if (!list.find((x: any) => x.userId === a.userId)) {
              list.push({
                id: a.id,
                taskId: a.taskId,
                userId: a.userId,
                user: { fullName: a.userName || 'Користувач' },
                status: a.status,
                fulfilledRole: a.fulfilledRole,
                assignedAt: a.assignedAt ? new Date(a.assignedAt).toISOString() : '',
                pendingAction: a.pendingAction || null,
              });
            }
          });

        const getAssignments = (t: any) => taskAssignmentsMap.get(t.serverId) || taskAssignmentsMap.get(t.id) || [];
        return requestTasks.map((t: any) => {
          const taskAssignments = getAssignments(t);
          return {
            id: t.serverId || t.id,
            title: t.title,
            description: t.description,
            status: t.status,
            neededPeopleCount: t.neededPeopleCount,
            requiredRoles: t.requiredRoles,
            assignedCount: countActiveAssignments(taskAssignments),
            priority: t.priority,
            createdAt: t.createdAt,
            requestId: t.requestId || t.requestServerId,
            assignments: taskAssignments,
          };
        });
      }
    } catch (localError) {
      OfflineLogger.cache('Local tasks load failed:', localError);
    }
    return [];
  }, []);

  // ─── Load request from local DB ────────────────────────────────────────────
  const loadRequestLocal = useCallback(async (requestId: string): Promise<Request | null> => {
    try {
      const localReqs = await collections.requests.query().fetch();
      const local = localReqs.find((r: any) => r.serverId === requestId || r.id === requestId);
      if (local) {
        OfflineLogger.cache('Loaded request from local DB', { id: (local as any).serverId || local.id });

        // Check if request is saved in local DB
        let isSavedLocal = false;
        try {
          const saved = await collections.savedRequests.query().fetch();
          isSavedLocal = saved.some((s: any) => String(s.requestId) === String(requestId));
        } catch {}

        return {
          id: (local as any).serverId ?? local.id,
          title: (local as any).title,
          description: (local as any).description ?? '',
          category: (local as any).category as any,
          urgency: (local as any).urgency as any,
          status: (local as any).status as any,
          requiredClearance: (local as any).requiredClearance as any,
          latitude: (local as any).latitude != null ? (local as any).latitude : undefined,
          longitude: (local as any).longitude != null ? (local as any).longitude : undefined,
          isLocationHidden: (local as any).isLocationHidden,
          tags: (local as any).tags,
          additionalInfo: (local as any).additionalInfo,
          mediaUrls: (local as any).mediaUrls,
          reportUrls: (local as any).reportUrls,
          creatorId: (local as any).creatorId ?? '',
          createdAt: (local as any).createdAtServer ? new Date((local as any).createdAtServer).toISOString() : '',
          isSaved: isSavedLocal,
        } as any;
      }
    } catch (e) {
      OfflineLogger.cache('Local request load failed:', e);
    }
    return null;
  }, []);

  // ─── Helper: load from local DB with timeout (migration may block query) ──
  const loadLocalWithTimeout = useCallback(async () => {
    return Promise.race([
      Promise.all([loadRequestLocal(requestId), loadTasksLocal(requestId)]),
      new Promise<[Request | null, Task[]]>((resolve) =>
        setTimeout(() => {
          OfflineLogger.cache('RequestDetail: local DB timeout (migration?)');
          resolve([null, []]);
        }, 2000)
      )
    ]);
  }, [requestId, loadRequestLocal, loadTasksLocal]);

  const saveServerDataToDBDirect = useCallback(async (req: Request, taskList: Task[]) => {
    await safeWrite(async () => {
      const existingRequests = await collections.requests.query().fetch();
      const existingReq = existingRequests.find((r: any) => r.serverId === req.id) as any;

      const writeRequest = (r: any) => {
        r.serverId = req.id;
        r.title = req.title;
        r.description = req.description ?? null;
        r.category = req.category;
        r.urgency = req.urgency;
        r.status = req.status;
        r.requiredClearance = req.requiredClearance ?? 'local';
        r.creatorId = req.creatorId ?? null;
        r.latitude = req.latitude ?? null;
        r.longitude = req.longitude ?? null;
        r.isLocationHidden = req.isLocationHidden ?? false;
        r.tagsRaw = JSON.stringify(req.tags ?? []);
        r.additionalInfoRaw = JSON.stringify((req as any).additionalInfo ?? []);
        r.mediaUrlsRaw = JSON.stringify((req as any).mediaUrls ?? []);
        r.reportUrlsRaw = JSON.stringify((req as any).reportUrls ?? []);
        r.deadline = req.deadline ? new Date(req.deadline).getTime() : null;
        r.isSynced = true;
        r.pendingAction = null;
        r.lastSyncedAt = Date.now();
      };

      if (existingReq) {
        if (!existingReq.pendingAction) await existingReq.update(writeRequest);
      } else {
        await collections.requests.create((r: any) => {
          writeRequest(r);
          r.createdAtServer = req.createdAt ? new Date(req.createdAt).getTime() : Date.now();
        });
      }

      const existingTasks = await collections.tasks.query().fetch();
      const existingAssignments = await collections.taskAssignments.query().fetch();

      for (const serverTask of taskList) {
        const existingTask = existingTasks.find((t: any) => t.serverId === serverTask.id) as any;
        const activeCount = countActiveAssignments(serverTask.assignments as any[]);
        const writeTask = (t: any) => {
          t.serverId = serverTask.id;
          t.requestId = requestId;
          t.requestServerId = requestId;
          t.title = serverTask.title;
          t.description = serverTask.description ?? null;
          t.status = serverTask.status;
          t.neededPeopleCount = serverTask.neededPeopleCount ?? 1;
          t.requiredRolesRaw = JSON.stringify(serverTask.requiredRoles ?? []);
          t.assignedCount = activeCount;
          t.priority = serverTask.priority ?? 0;
          t.deadline = serverTask.deadline ? new Date(serverTask.deadline).getTime() : null;
          t.chatId = serverTask.chatId ?? null;
          t.isSynced = true;
          t.pendingAction = null;
          t.lastSyncedAt = Date.now();
        };

        if (existingTask) {
          if (!existingTask.pendingAction) await existingTask.update(writeTask);
        } else {
          await collections.tasks.create(writeTask);
        }

        if (!Array.isArray(serverTask.assignments)) continue;
        for (const assignment of serverTask.assignments) {
          const assignmentTaskId = assignment.taskId || serverTask.id;
          const existingAssignment = (existingAssignments as any[]).find(
            (a: any) => a.taskId === assignmentTaskId && a.userId === assignment.userId
          );
          const writeAssignment = (a: any) => {
            a.taskId = assignmentTaskId;
            a.userId = assignment.userId;
            a.userName = assignment.user?.fullName || assignment.userName || 'Користувач';
            a.status = assignment.status;
            a.fulfilledRole = assignment.fulfilledRole ?? null;
            a.assignedAt = assignment.assignedAt ? new Date(assignment.assignedAt).getTime() : Date.now();
            a.isSynced = true;
            a.pendingAction = null;
            a.lastSyncedAt = Date.now();
          };

          if (existingAssignment) {
            if (!existingAssignment.pendingAction) await existingAssignment.update(writeAssignment);
          } else {
            await collections.taskAssignments.create(writeAssignment);
          }
        }
      }
    });
  }, [requestId]);

  // ─── Helper: save server data to local DB (single atomic write) ────────
  const saveServerDataToDB = useCallback(async (req: Request, taskList: Task[]) => {
    try {
      // Fetch all records ONCE before write (with fail-safe for each fetch)
      let existingRequests: any[] = [];
      let existingTasks: any[] = [];
      let existingAssignmentsRaw: any[] = [];

      try {
        existingRequests = await collections.requests.query().fetch();
      } catch (fetchErr: any) {
        OfflineLogger.cache(`RequestDetail: fetch requests failed`, fetchErr);
      }

      try {
        existingTasks = await collections.tasks.query().fetch();
      } catch (fetchErr: any) {
        OfflineLogger.cache(`RequestDetail: fetch tasks failed`, fetchErr);
      }

      try {
        existingAssignmentsRaw = await collections.taskAssignments.query().fetch();
      } catch (fetchErr: any) {
        OfflineLogger.cache(`RequestDetail: fetch taskAssignments failed`, fetchErr);
      }

      const operations: any[] = [];

      // --- Save request ---
      const existingReq = existingRequests.find((r: any) => r.serverId === req.id);
      if (existingReq) {
        // Only update if request has no pending action (don't overwrite offline changes)
        if (!existingReq.pendingAction) {
          operations.push(
            existingReq.prepareUpdate((r: any) => {
              r.title = req.title;
              r.description = req.description ?? null;
              r.category = req.category;
              r.urgency = req.urgency;
              r.status = req.status;
              r.requiredClearance = req.requiredClearance ?? 'local';
              r.latitude = req.latitude ?? null;
              r.longitude = req.longitude ?? null;
              r.isLocationHidden = req.isLocationHidden ?? false;
              r.tagsRaw = JSON.stringify(req.tags ?? []);
              r.additionalInfoRaw = JSON.stringify((req as any).additionalInfo ?? []);
              r.mediaUrlsRaw = JSON.stringify((req as any).mediaUrls ?? []);
              r.reportUrlsRaw = JSON.stringify((req as any).reportUrls ?? []);
              r.deadline = req.deadline ? new Date(req.deadline).getTime() : null;
              r.isSynced = true;
              r.lastSyncedAt = Date.now();
            })
          );
        } else {
          OfflineLogger.cache(`RequestDetail: SKIP request update — has pendingAction`);
        }
      } else {
        operations.push(
          collections.requests.prepareCreate((r: any) => {
            r.serverId = req.id;
            r.title = req.title;
            r.description = req.description ?? null;
            r.category = req.category;
            r.urgency = req.urgency;
            r.status = req.status;
            r.requiredClearance = req.requiredClearance ?? 'local';
            r.creatorId = req.creatorId ?? null;
            r.latitude = req.latitude ?? null;
            r.longitude = req.longitude ?? null;
            r.isLocationHidden = req.isLocationHidden ?? false;
            r.tagsRaw = JSON.stringify(req.tags ?? []);
            r.additionalInfoRaw = JSON.stringify((req as any).additionalInfo ?? []);
            r.mediaUrlsRaw = JSON.stringify((req as any).mediaUrls ?? []);
            r.reportUrlsRaw = JSON.stringify((req as any).reportUrls ?? []);
            r.deadline = req.deadline ? new Date(req.deadline).getTime() : null;
            r.createdAtServer = req.createdAt ? new Date(req.createdAt).getTime() : Date.now();
            r.isSynced = true;
            r.lastSyncedAt = Date.now();
          })
        );
      }

      // --- Save tasks ---
      const existingTasksMap = new Map(existingTasks.map((t: any) => [t.serverId, t]));
      const assignmentsMap = new Map(
        (existingAssignmentsRaw as any[]).map((a: any) => [`${a.taskId}-${a.userId}`, a])
      );

      for (const task of taskList) {
        const existingTask = existingTasksMap.get(task.id);
        if (existingTask) {
          // Don't overwrite tasks with pending offline changes
          if (!existingTask.pendingAction) {
            operations.push(
              existingTask.prepareUpdate((t: any) => {
                t.title = task.title;
                t.description = task.description ?? null;
                t.status = task.status;
                t.neededPeopleCount = task.neededPeopleCount;
                t.requiredRolesRaw = JSON.stringify(task.requiredRoles ?? []);
                t.assignedCount = task.assignments?.filter((a: any) => a.status !== 'withdrawn').length ?? 0;
                t.priority = task.priority ?? 0;
                t.deadline = task.deadline ? new Date(task.deadline).getTime() : null;
                t.isSynced = true;
                t.lastSyncedAt = Date.now();
              })
            );
          } else {
            OfflineLogger.cache(`RequestDetail: SKIP task update for ${task.id} — has pendingAction`);
          }
        } else {
          operations.push(
            collections.tasks.prepareCreate((t: any) => {
              t.serverId = task.id;
              t.requestId = requestId;
              t.requestServerId = requestId;
              t.title = task.title;
              t.description = task.description ?? null;
              t.status = task.status;
              t.neededPeopleCount = task.neededPeopleCount ?? 1;
              t.requiredRolesRaw = JSON.stringify(task.requiredRoles ?? []);
              t.assignedCount = task.assignments?.filter((a: any) => a.status !== 'withdrawn').length ?? 0;
              t.priority = task.priority ?? 0;
              t.deadline = task.deadline ? new Date(task.deadline).getTime() : null;
              t.isSynced = true;
              t.lastSyncedAt = Date.now();
            })
          );
        }

        // Also save/update taskAssignments
        if (task.assignments && Array.isArray(task.assignments)) {
          for (const a of task.assignments) {
            const taskId = a.taskId || task.id;
            const key = `${taskId}-${a.userId}`;
            const existingAssignment = assignmentsMap.get(key);

            if (existingAssignment) {
              if (!existingAssignment.pendingAction) {
                operations.push(
                  existingAssignment.prepareUpdate((asgn: any) => {
                    asgn.status = a.status;
                    asgn.userName = a.user?.fullName || a.userName || 'Користувач';
                    asgn.fulfilledRole = a.fulfilledRole ?? null;
                    asgn.assignedAt = a.assignedAt ? new Date(a.assignedAt).getTime() : Date.now();
                    asgn.isSynced = true;
                    asgn.lastSyncedAt = Date.now();
                  })
                );
              } else {
                OfflineLogger.cache(`RequestDetail: SKIP assignment update for ${key} — has pendingAction`);
              }
            } else {
              operations.push(
                collections.taskAssignments.prepareCreate((asgn: any) => {
                  asgn.taskId = taskId;
                  asgn.userId = a.userId;
                  asgn.userName = a.user?.fullName || a.userName || 'Користувач';
                  asgn.status = a.status;
                  asgn.fulfilledRole = a.fulfilledRole ?? null;
                  asgn.assignedAt = a.assignedAt ? new Date(a.assignedAt).getTime() : Date.now();
                  asgn.isSynced = true;
                  asgn.pendingAction = null;
                  asgn.lastSyncedAt = Date.now();
                })
              );
            }
          }
        }
      }

      if (operations.length > 0) {
        OfflineLogger.cache(`RequestDetail: executing ${operations.length} ops via SyncService.executeBatch`);
        try {
          await SyncService.executeBatch(operations, 'requestDetail');
          OfflineLogger.cache(`RequestDetail: saved ${operations.length} ops to DB for request ${req.id}`);
        } catch (batchErr: any) {
          OfflineLogger.cache(`RequestDetail: executeBatch FAILED`, batchErr);
          throw batchErr; // rethrow so caller sees the error
        }
      }
    } catch (e: any) {
      // Single attempt only — if Diagnostic error, SyncService.pull will handle it
      const isDiagnostic = e?.name === 'Diagnostic error' || String(e?.message || '').includes('Diagnostic');
      if (isDiagnostic) {
        try {
          await saveServerDataToDBDirect(req, taskList);
          OfflineLogger.cache(`RequestDetail: direct fallback saved server data for request ${req.id}`);
        } catch (fallbackErr) {
          OfflineLogger.cache('RequestDetail: direct fallback save failed', fallbackErr);
        }
      }
      OfflineLogger.cache(`RequestDetail: save failed${isDiagnostic ? ' (Diagnostic — sync will update)' : ''}`, e);
    }
  }, [requestId, saveServerDataToDBDirect]);

  const isLoadingRef = useRef(false);

  // ─── Main load: OFFLINE-FIRST ────────────────────────────────────────────
  const load = useCallback(async () => {
    if (isLoadingRef.current) {
      OfflineLogger.nav('RequestDetailScreen.load() skipped — already loading');
      return;
    }
    isLoadingRef.current = true;
    OfflineLogger.nav(`RequestDetailScreen.load() called, requestId=${requestId}`);

    try {
      // КРОК 1: Завантажити з локальної БД (без агресивного таймауту)
      // Таймаут лише для офлайн — 5с, для онлайн чекаємо повністю
      const [localRequest, localTasks] = await (async () => {
        try {
          const result = await Promise.all([loadRequestLocal(requestId), loadTasksLocal(requestId)]);
          if (result[0] || result[1].length > 0) return result;
        } catch {}

        // Фолбек тільки якщо локальні дані пусті — тоді таймаут
        if (isOffline) {
          return Promise.race([
            Promise.all([loadRequestLocal(requestId), loadTasksLocal(requestId)]),
            new Promise<[null, []]>((resolve) =>
              setTimeout(() => {
                OfflineLogger.cache('RequestDetail: local DB timeout (5000ms, offline)');
                resolve([null, []]);
              }, 5000)
            )
          ]);
        }
        return [null, []];
      })();

      if (localRequest) {
        OfflineLogger.nav('Showing local data first (offline-first)');
        setRequest(localRequest);
        setIsOfflineMode(true);
        setLoading(false);
      }
      if (localTasks.length > 0) {
        setTasks(localTasks);
      }

      // Also check saved status from local DB for initial state
      try {
        const saved = await collections.savedRequests.query().fetch();
        const isSavedLocal = saved.some((s: any) => String(s.requestId) === String(requestId));
        if (isSavedLocal) setIsSaved(true);
      } catch {}

      if (!localRequest && !isOffline) {
        setLoading(false);
      }

      // КРОК 2: Якщо є мережа І сервер реально доступний — оновити з сервера
      if (!isOffline && getServerReachable()) {
        try {
          OfflineLogger.nav('Fetching from server...');
          const req = await requestsApi.getOne(requestId);
          console.log('[RequestDetail] Server response for', requestId, 'isSaved:', (req as any).isSaved);
          setRequest(req);
          // Explicitly set isSaved from server response
          if ((req as any).isSaved !== undefined) {
            console.log('[RequestDetail] Setting isSaved from server response:', (req as any).isSaved);
            setIsSaved((req as any).isSaved);
          }
          setIsOfflineMode(false);

          try {
            const serverTasks = await tasksApi.getByRequest(requestId);
            // Recalculate assignedCount from assignments (backend getter may not be serialized)
            serverTasks.forEach((t: any) => {
              if (t.assignments && Array.isArray(t.assignments)) {
                t.assignedCount = t.assignments.filter((a: any) => a.status !== 'withdrawn' && a.status !== 'completed').length;
              }
            });
            // MERGE: preserve local pendingAction in server assignments
            // Server doesn't know about pendingAction, so we need to carry it over from local tasks
            const localTasksWithPending = new Map<string, Map<string, any>>();
            for (const lt of localTasks) {
              if (lt.assignments && lt.assignments.length > 0) {
                const taskMap = new Map<string, any>();
                for (const a of lt.assignments) {
                  if ((a as any).pendingAction) {
                    taskMap.set(a.userId, a);
                  }
                }
                if (taskMap.size > 0) localTasksWithPending.set(lt.id, taskMap);
              }
            }
            for (const st of serverTasks) {
              const pendingAssignments = localTasksWithPending.get(st.id);
              if (pendingAssignments && st.assignments) {
                for (const sa of st.assignments) {
                  const localPending = pendingAssignments.get(sa.userId);
                  if (localPending) {
                    (sa as any).pendingAction = (localPending as any).pendingAction;
                  }
                }
              }
            }
            setTasks(serverTasks);
            // ЗБЕРЕГТИ заявку та задачі в БД (атомарно)
            await saveServerDataToDB(req, serverTasks);
          } catch (serverTaskError) {
            // Tasks fetch failed, still save request alone
            OfflineLogger.network('Server tasks failed, saving request only to local DB');
            try {
              await saveServerDataToDB(req, []);
            } catch (dbErr) {
              OfflineLogger.cache('Failed to save request to local DB', dbErr);
            }
            OfflineLogger.network('Server tasks failed, keeping local tasks');
            // Залишаємо локальні задачі
          }
        } catch (serverError: any) {
          OfflineLogger.network('Server request failed:', serverError);
          // If server returns 404, the request was deleted
          if (serverError.response?.status === 404) {
            // Delete from local DB
            try {
              const existing = await collections.requests.query().fetch();
              const localReq = existing.find((r: any) => r.serverId === requestId || r.id === requestId);
              if (localReq) {
                await safeWrite(async () => {
                  await localReq.destroyPermanently();
                });
              }
              // Also remove from saved requests
              const saved = await collections.savedRequests.query().fetch();
              const savedReq = saved.find((s: any) => s.requestId === requestId);
              if (savedReq) {
                await safeWrite(async () => {
                  await savedReq.destroyPermanently();
                });
              }
            } catch (localErr) {
              OfflineLogger.cache('Error deleting local request after 404', localErr);
            }
            Alert.alert('Заявка не знайдена', 'Ця заявка більше не існує');
            if (navigation.canGoBack()) navigation.goBack();
            else navigation.navigate('RequestsList' as never);
            return;
          }
          if (!localRequest) {
            // Немає ні локальних, ні серверних даних
            Alert.alert('Помилка', 'Не вдалося завантажити заявку');
            if (navigation.canGoBack()) navigation.goBack();
            else navigation.navigate('RequestsList' as never);
          }
        }
      } else {
        OfflineLogger.nav('Offline — showing cached data only');
      }
    } catch (e) {
      OfflineLogger.nav('RequestDetail: unexpected error', e);
    } finally {
      // КРИТИЧНО: завжди знімати loading
      isLoadingRef.current = false;
      setLoading(false);
      setRefreshing(false);
    }
  }, [requestId, loadRequestLocal, loadTasksLocal, navigation, isOffline, saveServerDataToDB]);

  // ─── Load pending REQUEST_ADD_INFO and REQUEST_UPDATE from action_queue ──
  const loadPendingRequestActions = useCallback(async () => {
    try {
      const queueItems = await collections.actionQueue.query().fetch();
      const addInfo: Array<{ id: string; text: string; createdAt: number; attachmentsCount: number }> = [];
      const updates: Array<{ id: string; expiresAt: number }> = [];

      for (const item of (queueItems as any[])) {
        try {
          const payload = JSON.parse(item.payloadRaw || '{}');
          if (item.actionType === 'REQUEST_ADD_INFO' && payload.requestId === requestId) {
            const attachments = payload.attachments;
            const attachmentsCount = Array.isArray(attachments) ? attachments.length : 0;
            addInfo.push({ id: item.id, text: payload.text || '', createdAt: item.createdAt, attachmentsCount });
          }
          if (item.actionType === 'REQUEST_UPDATE' && payload.requestId === requestId) {
            updates.push({ id: item.id, expiresAt: payload.expiresAt || 0 });
          }
        } catch {}
      }

      setPendingAddInfoActions(addInfo);
      setPendingUpdateActions(updates);
    } catch (e) {
      console.warn('[RequestDetail] Failed to load pending request actions', e);
    }
  }, [requestId]);

  // Load pending request actions on mount + interval
  useEffect(() => {
    loadPendingRequestActions();
    const interval = setInterval(loadPendingRequestActions, 3000);
    return () => clearInterval(interval);
  }, [loadPendingRequestActions]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Update isSaved when request changes (e.g., when server data arrives with isSaved flag)
  useEffect(() => {
    if (request && (request as any).isSaved !== undefined) {
      setIsSaved((request as any).isSaved);
    }
  }, [request]);

  // Check saved status from local DB when offline (fallback)
  useEffect(() => {
    // If request already has isSaved from server, don't check local DB
    if (request && (request as any).isSaved !== undefined) {
      return;
    }
    // Only check local DB when offline
    if (isOffline) {
      checkSavedLocal().then(saved => setIsSaved(saved));
    }
  }, [requestId, isOffline, checkSavedLocal]);

  // On mount, check local saved status as initial state
  useEffect(() => {
    const initSaved = async () => {
      try {
        const saved = await collections.savedRequests.query().fetch();
        const savedLocal = saved.some((s: any) => String(s.requestId) === String(requestId));
        if (savedLocal) setIsSaved(true);
      } catch {}
    };
    initSaved();
  }, [requestId]);

  // ─── Toggle bookmark (save/unsave request) ───────────────────────────────
  const toggleBookmark = async () => {
    if (bookmarkLoading) return;
    setBookmarkLoading(true);
    try {
      if (isSaved) {
        await requestsApi.unsave(requestId);
        // Remove from local DB quietly (don't block UI on error)
        try {
          const saved = await collections.savedRequests.query().fetch();
          const item = saved.find((s: any) => s.requestId === requestId);
          if (item) await safeWrite(() => item.destroyPermanently());
        } catch (localErr) {
          OfflineLogger.cache('RequestDetail: failed to remove local bookmark entry', localErr);
        }
        setIsSaved(false);
      } else {
        await requestsApi.save(requestId);
        // Add to local DB quietly (don't block UI on error)
        try {
          await safeWrite(() =>
            collections.savedRequests.create((s: any) => {
              s.requestId = requestId;
              s.userId = user?.id || '';
              s.savedAt = Date.now();
            })
          );
        } catch (localErr) {
          OfflineLogger.cache('RequestDetail: failed to insert local bookmark entry', localErr);
        }
        setIsSaved(true);
      }
    } catch (e) {
      OfflineLogger.cache('RequestDetail: failed to toggle bookmark', e);
      Alert.alert('Помилка', 'Не вдалося зберегти заявку');
    } finally {
      setBookmarkLoading(false);
    }
  };

  const handleCancelRequest = async () => {
    Alert.alert('Скасувати заявку?', 'Цю дію неможливо відмінити.', [
      { text: 'Ні' },
      {
        text: 'Так, скасувати', style: 'destructive',
        onPress: async () => {
          await requestsApi.update(requestId, { status: RequestStatus.CANCELLED });
          load();
        },
      },
    ]);
  };

  if (loading) return <LoadingScreen />;
  if (!request) return null;

  const doneTasks  = tasks.filter((t) => t.status === TaskStatus.DONE).length;
  const totalTasks = tasks.length;
  const urgency    = urgencyColors[request.urgency];
  const status     = statusColors[request.status];

  const isOwner = user?.id === request.creatorId;
  const isAdmin = user?.systemRole === SystemRole.ADMIN;
  const isCoord = user?.systemRole === SystemRole.COORDINATOR;
  const isVolunteer = user?.systemRole === SystemRole.VOLUNTEER;

  // Перевірка: чи волонтер бере участь хоча б в одній задачі цієї заявки
  const isParticipant = tasks.some(t => t.assignments?.some(a => a.userId === user?.id));

  const canManage = isOwner || isAdmin;
  const canCreateTask = isOwner || isAdmin || isCoord;
  const canSubmitReview = isVolunteer && isParticipant;
  const canEdit = (isOwner || isAdmin) && tasks.every(t => !t.assignments?.some(a => a.status !== 'withdrawn'));

  const handleUpdate = async (data: any) => {
    try {
      await requestsApi.update(requestId, data);
      load();
    } catch (e) {
      Alert.alert('Помилка', 'Не вдалося оновити заявку');
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: Colors.background }}>
      <ScreenHeader
        title="Деталі заявки"
        onBack={() => navigation.goBack()}
        rightAction={
          <TouchableOpacity
            onPress={toggleBookmark}
            disabled={bookmarkLoading}
            style={{ padding: 8 }}
          >
            <Text style={{ fontSize: 24, opacity: bookmarkLoading ? 0.5 : 1 }}>
              {isSaved ? '⭐' : '☆'}
            </Text>
          </TouchableOpacity>
        }
      />

      {/* Action buttons row to avoid header overlap */}
      {(isOwner || isAdmin) && (
        <View style={{ flexDirection: 'row', paddingHorizontal: 16, paddingTop: 12, gap: 10 }}>
          {canEdit && (
            <TouchableOpacity
              style={[styles.headerActionBtn, { backgroundColor: Colors.primary }]}
              onPress={() => navigation.navigate('CreateRequest', { requestId })}
            >
              <Text style={styles.headerActionText}>✏️ Редагувати</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[styles.headerActionBtn, { backgroundColor: Colors.secondary }]}
            onPress={() => navigation.navigate('CreateRequest', { requestId, mode: 'additional' })}
          >
            <Text style={styles.headerActionText}>➕ Доповнити</Text>
          </TouchableOpacity>
        </View>
      )}

      {isOfflineMode && (
        <View style={{ backgroundColor: Colors.warningLight, padding: 8, alignItems: 'center' }}>
          <Text style={{ fontSize: 12, color: Colors.warning }}>
            📴 Офлайн режим — показано кешовані дані
          </Text>
        </View>
      )}
      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={Colors.primary} />}
        contentContainerStyle={{ paddingBottom: 32 }}
      >
        {/* Pending cards for request-level offline actions */}
        {pendingAddInfoActions.length > 0 && (
          <Card style={{ marginTop: 12 }}>
            {pendingAddInfoActions.map((pa) => (
              <View key={pa.id} style={{ padding: 8, marginBottom: 6, backgroundColor: '#FFF8E1', borderRadius: 8, borderWidth: 1.5, borderColor: Colors.primary }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Text style={{ fontSize: 13, fontWeight: '600', color: '#F57C00', flex: 1, flexWrap: 'wrap' }}>
                    🕒 Доповнення очікує на мережу
                  </Text>
                  <TouchableOpacity
                    style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, backgroundColor: 'rgba(255,255,255,0.7)' }}
                    onPress={async () => {
                      try {
                        const queueItems = await collections.actionQueue.query().fetch();
                        const item = queueItems.find((q: any) => q.id === pa.id);
                        if (item) await safeWrite(() => item.destroyPermanently());
                        loadPendingRequestActions();
                      } catch (e) {
                        console.warn('Failed to cancel pending add info', e);
                      }
                    }}
                  >
                    <Text style={{ fontSize: 12, fontWeight: '700', color: '#E65100' }}>Скасувати</Text>
                  </TouchableOpacity>
                </View>
                {pa.text ? <Text style={{ fontSize: 12, color: '#666', marginTop: 4, marginLeft: 4 }} numberOfLines={2}>{pa.text}</Text> : null}
                {pa.attachmentsCount > 0 && (
                  <Text style={{ fontSize: 12, color: '#F57C00', marginTop: 4, marginLeft: 4 }}>
                    📎 {pa.attachmentsCount} файл{pa.attachmentsCount > 1 ? 'ів' : ''}
                  </Text>
                )}
              </View>
            ))}
          </Card>
        )}

        {pendingUpdateActions.length > 0 && pendingUpdateActions.map((pu) => {
          const remaining = Math.max(0, pu.expiresAt - Date.now());
          const remainingSec = Math.ceil(remaining / 1000);
          const remainingMin = Math.floor(remainingSec / 60);
          const remainingSecDisplay = remainingSec % 60;
          const expired = remaining <= 0;
          return (
            <Card key={pu.id} style={{ marginTop: 12 }}>
              <View style={{ padding: 8, backgroundColor: expired ? '#FFEBEE' : '#FFF8E1', borderRadius: 8, borderWidth: 1.5, borderColor: expired ? Colors.danger : Colors.primary }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Text style={{ fontSize: 13, fontWeight: '600', color: expired ? Colors.danger : '#F57C00', flex: 1, flexWrap: 'wrap' }}>
                    {expired ? '⏰ Час вийшов — зміни не застосовано' : `🕒 Редагування очікує на мережу`}
                  </Text>
                  {!expired && (
                    <TouchableOpacity
                      style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, backgroundColor: 'rgba(255,255,255,0.7)' }}
                      onPress={async () => {
                        try {
                          const queueItems = await collections.actionQueue.query().fetch();
                          const item = queueItems.find((q: any) => q.id === pu.id);
                          if (item) await safeWrite(() => item.destroyPermanently());
                          loadPendingRequestActions();
                        } catch (e) {
                          console.warn('Failed to cancel pending update', e);
                        }
                      }}
                    >
                      <Text style={{ fontSize: 12, fontWeight: '700', color: '#E65100' }}>Скасувати</Text>
                    </TouchableOpacity>
                  )}
                </View>
                {!expired && (
                  <Text style={{ fontSize: 12, color: '#666', marginTop: 4, marginLeft: 4 }}>
                    ⏱ Скасується через: {remainingMin}:{remainingSecDisplay.toString().padStart(2, '0')}
                  </Text>
                )}
                <Text style={{ fontSize: 11, color: '#999', marginTop: 4, marginLeft: 4 }}>
                  💡 Для швидких правок використайте «Доповнити» без часових обмежень
                </Text>
              </View>
            </Card>
          );
        })}

        {/* Main info card */}
        <Card style={{ marginTop: 16 }}>
          <View style={[styles.urgencyStrip, { backgroundColor: urgency?.bg }]} />

          <Text style={styles.title}>{request.title}</Text>

          <View style={styles.badgeRow}>
            <Badge label={urgency?.label ?? request.urgency} colorScheme="urgency" value={request.urgency} />
            <Badge label={status?.label  ?? request.status}  colorScheme="status"  value={request.status} />
            <Badge label={categoryLabels[request.category] ?? request.category} />
          </View>

          {request.description ? (
            <Text style={styles.description}>{request.description}</Text>
          ) : null}

          {/* Request media files (main) */}
          {(request as any).mediaUrls?.length > 0 && (
            <View style={{ marginTop: 8 }}>
              <Text style={{ fontSize: 13, fontWeight: '600', color: Colors.text, marginBottom: 8 }}>📎 Вкладення</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {(request as any).mediaUrls.map((file: any, idx: number) => {
                  const isImage = (file.type || '').startsWith('image/');
                  const isVideo = (file.type || '').startsWith('video/');
                  const fileUrl = file.url?.startsWith('http') ? file.url : `${API_BASE_URL.replace('/api', '')}${file.url}`;
                  return (
                    <TouchableOpacity
                      key={idx}
                      onPress={() => {
                        if (isImage || isVideo) {
                          setSelectedMedia({ url: fileUrl, type: isImage ? 'image' : 'video' });
                          setMediaViewerVisible(true);
                        } else {
                          Linking.openURL(fileUrl).catch(() => Alert.alert('Помилка', 'Не вдалося відкрити файл'));
                        }
                      }}
                    >
                      {isImage ? (
                        <Image
                          source={{ uri: fileUrl }}
                          style={{ width: 120, height: 120, borderRadius: 8, backgroundColor: Colors.borderLight }}
                          resizeMode="cover"
                        />
                      ) : isVideo ? (
                        <View style={{ width: 120, height: 120, borderRadius: 8, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' }}>
                          <Text style={{ fontSize: 32 }}>▶️</Text>
                          <Text style={{ fontSize: 10, color: '#fff', marginTop: 4 }}>Відео</Text>
                        </View>
                      ) : (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 8, backgroundColor: Colors.borderLight, borderRadius: 8 }}>
                          <Text>📄</Text>
                          <Text style={{ fontSize: 13, flex: 1 }} numberOfLines={1}>{file.name}</Text>
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          )}

          {/* Meta rows */}
          <View style={styles.metaList}>
            <MetaRow icon="🔒" label="Допуск" value={clearanceLabels[request.requiredClearance] ?? request.requiredClearance} />
            {!!request.deadline && (
              <MetaRow icon="⏰" label="Дедлайн" value={new Date(request.deadline).toLocaleDateString('uk-UA', { day: 'numeric', month: 'long', year: 'numeric' })} />
            )}
            {request.latitude ? (
              <LocationDisplay request={request} />
            ) : null}
            {request.isLocationHidden && (
              <View style={{ marginTop: 8, padding: 8, backgroundColor: Colors.warningLight, borderRadius: 8 }}>
                <Text style={{ fontSize: 12, color: Colors.warning }}>
                  ⚠️ Координати приховані з міркувань безпеки.
                </Text>
              </View>
            )}
            {!!request.fundraisingUrl && (
              <TouchableOpacity onPress={() => Linking.openURL(request.fundraisingUrl!)}>
                <MetaRow icon="💳" label="Збір" value="Перейти до збору коштів →" highlight />
              </TouchableOpacity>
            )}
          </View>

          {/* Tags */}
          {request.tags?.filter(Boolean).length > 0 && (
            <View style={styles.tagRow}>
              {request.tags.filter(Boolean).map((tag) => (
                <View key={tag} style={styles.tag}>
                  <Text style={styles.tagText}>{tag}</Text>
                </View>
              ))}
            </View>
          )}
        </Card>

        {/* Additional Info (History) */}
        {request.additionalInfo && request.additionalInfo.length > 0 && (
          <Card style={{ marginTop: 12 }}>
            <Text style={styles.sectionTitle}>Доповнення до заявки</Text>
            {request.additionalInfo.map((info, index) => {
              const createdAt = new Date(info.createdAt);
              const diffMs = new Date().getTime() - createdAt.getTime();
              const canEditInfo = (isOwner || isAdmin) && diffMs < 30 * 60 * 1000;

              return (
                <View key={info.id || `info-${index}`} style={styles.additionalInfoItem}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={styles.additionalInfoDate}>
                      📅 {createdAt.toLocaleString('uk-UA')}
                      {!!info.updatedAt && ' (ред.)'}
                    </Text>
                    {canEditInfo && editingInfoId !== info.id && (
                      <View style={{ flexDirection: 'row', gap: 12 }}>
                    <TouchableOpacity onPress={() => {
                          setEditingInfoId(info.id);
                          setEditingText(info.text);
                          setExistingInfoFiles(info.attachments || []);
                          setRemovedInfoUrls([]);
                          setSelectedFiles([]);
                        }}>
                          <Text style={{ fontSize: 12, color: Colors.primary }}>✏️</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => {
                          Alert.alert('Видалити?', 'Ви впевнені?', [
                            { text: 'Ні' },
                            { text: 'Так', style: 'destructive', onPress: async () => {
                              try {
                                await requestsApi.removeAdditionalInfo(request.id, info.id);
                                load();
                              } catch (e) {
                                Alert.alert('Помилка', 'Не вдалося видалити');
                              }
                            }}
                          ]);
                        }}>
                          <Text style={{ fontSize: 12, color: Colors.danger }}>🗑</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>

                  {editingInfoId === info.id ? (
                    <View style={{ marginTop: 8 }}>
                      <Input
                        value={editingText}
                        onChangeText={setEditingText}
                        multiline
                        autoFocus
                      />
                      {existingInfoFiles.length > 0 && (
                        <View style={{ marginTop: 12 }}>
                          <Text style={{ fontSize: 12, fontWeight: '600', color: Colors.textMuted, marginBottom: 6 }}>Вкладення:</Text>
                          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                            {existingInfoFiles.map((file: any, fileIdx: number) => {
                              const isRemoved = removedInfoUrls.includes(file.url);
                              const isImage = file.type?.startsWith('image/');
                              const isVideo = file.type?.startsWith('video/');
                              const fileUrl = file.url?.startsWith('http') ? file.url : `${API_BASE_URL.replace('/api', '')}${file.url}`;
                              return (
                                <View key={fileIdx} style={{ position: 'relative' }}>
                                  <TouchableOpacity
                                    onPress={() => {
                                      if (!isRemoved && (isImage || isVideo)) {
                                        setSelectedMedia({ url: fileUrl, type: isImage ? 'image' : 'video' });
                                        setMediaViewerVisible(true);
                                      } else if (!isRemoved) {
                                        Linking.openURL(fileUrl).catch(() => Alert.alert('Помилка', 'Не вдалося відкрити файл'));
                                      }
                                    }}
                                  >
                                    {isImage ? (
                                      <Image source={{ uri: fileUrl }} style={{ width: 80, height: 80, borderRadius: 6, backgroundColor: Colors.borderLight, opacity: isRemoved ? 0.3 : 0.8 }} resizeMode="cover" />
                                    ) : isVideo ? (
                                      <View style={{ width: 80, height: 80, borderRadius: 6, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center', opacity: isRemoved ? 0.3 : 0.8 }}>
                                        <Text style={{ fontSize: 20 }}>▶️</Text>
                                      </View>
                                    ) : (
                                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, padding: 6, backgroundColor: Colors.borderLight, borderRadius: 6, opacity: isRemoved ? 0.3 : 1 }}>
                                        <Text style={{ fontSize: 16 }}>📄</Text>
                                        <Text style={{ fontSize: 11, flex: 1 }} numberOfLines={1}>{file.name}</Text>
                                      </View>
                                    )}
                                  </TouchableOpacity>
                                  {isRemoved ? (
                                    <TouchableOpacity
                                      onPress={() => setRemovedInfoUrls(prev => prev.filter(u => u !== file.url))}
                                      style={{ position: 'absolute', top: -4, right: -4, backgroundColor: Colors.secondary, borderRadius: 12, width: 22, height: 22, justifyContent: 'center', alignItems: 'center' }}
                                    >
                                      <Text style={{ color: '#fff', fontSize: 12 }}>↩</Text>
                                    </TouchableOpacity>
                                  ) : (
                                    <TouchableOpacity
                                      onPress={() => setRemovedInfoUrls(prev => [...prev, file.url])}
                                      style={{ position: 'absolute', top: -4, right: -4, backgroundColor: Colors.danger, borderRadius: 12, width: 22, height: 22, justifyContent: 'center', alignItems: 'center' }}
                                    >
                                      <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>✕</Text>
                                    </TouchableOpacity>
                                  )}
                                </View>
                              );
                            })}
                          </View>
                        </View>
                      )}
                      <View style={{ marginTop: 12 }}>
                        <TouchableOpacity onPress={async () => {
                          const res = await DocumentPicker.getDocumentAsync({ multiple: true });
                          if (!res.canceled) setSelectedFiles(res.assets.map(a => ({ uri: a.uri, name: a.name, type: (a as any).mimeType || 'application/octet-stream' })));
                        }} style={{ padding: 8, backgroundColor: Colors.borderLight, borderRadius: 8, alignItems: 'center' }}>
                          <Text style={{ color: Colors.primary, fontWeight: '600' }}>{selectedFiles.length > 0 ? `+ Додати ще файли (${selectedFiles.length})` : '+ Додати нові файли'}</Text>
                        </TouchableOpacity>
                        {selectedFiles.map((file, idx) => (
                          <View key={idx} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4, padding: 6, backgroundColor: Colors.surface, borderRadius: 6 }}>
                            <Text style={{ fontSize: 12, flex: 1 }}>{file.name}</Text>
                            <TouchableOpacity onPress={() => setSelectedFiles(prev => prev.filter((_, i) => i !== idx))}>
                              <Text style={{ color: Colors.danger }}>✕</Text>
                            </TouchableOpacity>
                          </View>
                        ))}
                      </View>
                      <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                        <Button
                          title="Зберегти"
                          size="sm"
                          loading={savingInfo || isUploading}
                          onPress={async () => {
                            if (!editingText.trim()) return;
                            setIsUploading(true);
                            try {
                              await requestsApi.updateAdditionalInfo(request.id, info.id, editingText.trim(), selectedFiles, removedInfoUrls.length > 0 ? removedInfoUrls : undefined);
                              setEditingInfoId(null);
                              setSelectedFiles([]);
                              load();
                            } catch (e) {
                              Alert.alert('Помилка', 'Не вдалося зберегти');
                            } finally {
                              setIsUploading(false);
                            }
                          }}
                        />
                        <Button
                          title="Скасувати"
                          variant="ghost"
                          size="sm"
                          onPress={() => { setEditingInfoId(null); setSelectedFiles([]); }}
                        />
                      </View>
                    </View>
                  ) : (
                    <View>
                      <Text style={styles.additionalInfoText}>{info.text}</Text>
                      {info.attachments?.length > 0 && (
                        <View style={{ marginTop: 8, flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                          {info.attachments.map((file: any, fileIdx: number) => {
                            const isImage = file.type?.startsWith('image/');
                            const isVideo = file.type?.startsWith('video/');
                            const fileUrl = file.url?.startsWith('http') ? file.url : `${API_BASE_URL.replace('/api', '')}${file.url}`;
                            return (
                              <TouchableOpacity
                                key={fileIdx}
                                onPress={() => {
                                  if (isImage || isVideo) {
                                    setSelectedMedia({ url: fileUrl, type: isImage ? 'image' : 'video' });
                                    setMediaViewerVisible(true);
                                  } else {
                                    Linking.openURL(fileUrl).catch(() => Alert.alert('Помилка', 'Не вдалося відкрити файл'));
                                  }
                                }}
                              >
                                {isImage ? (
                                  <Image
                                    source={{ uri: fileUrl }}
                                    style={{ width: 120, height: 120, borderRadius: 8, backgroundColor: Colors.borderLight }}
                                    resizeMode="cover"
                                  />
                                ) : isVideo ? (
                                  <View style={{ width: 120, height: 120, borderRadius: 8, backgroundColor: '#000', justifyContent: 'center', alignItems: 'center' }}>
                                    <Text style={{ fontSize: 32 }}>▶️</Text>
                                    <Text style={{ fontSize: 10, color: '#fff', marginTop: 4 }}>Відео</Text>
                                  </View>
                                ) : (
                                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 8, backgroundColor: Colors.borderLight, borderRadius: 8 }}>
                                    <Text>📄</Text>
                                    <Text style={{ fontSize: 13, flex: 1 }} numberOfLines={1}>{file.name}</Text>
                                  </View>
                                )}
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                      )}
                    </View>
                  )}
                </View>
              );
            })}
          </Card>
        )}

        {/* Progress */}
        {totalTasks > 0 && (
          <Card>
            <View style={styles.progressHeader}>
              <Text style={styles.sectionTitle}>Прогрес виконання</Text>
              <Text style={styles.progressCount}>{doneTasks}/{totalTasks}</Text>
            </View>
            <ProgressBar value={doneTasks} total={totalTasks} color={Colors.secondary} />
            <Text style={styles.progressPct}>
              {totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0}% завершено
            </Text>
          </Card>
        )}

        {/* Kanban board */}
        <View style={styles.kanbanHeader}>
          <Text style={styles.sectionTitle}>Kanban-дошка підзадач</Text>
          {canCreateTask && (
            <TouchableOpacity
              style={styles.addTaskBtn}
              onPress={() => navigation.navigate('TaskDetail', { taskId: '__new__', requestId, requestTitle: request.title })}
            >
              <Text style={{ color: Colors.primary, fontWeight: '700', fontSize: 13 }}>+ Додати</Text>
            </TouchableOpacity>
          )}
        </View>

        {tasks.length === 0 ? (
          <EmptyState icon="📌" title="Підзадач немає" subtitle={canCreateTask ? 'Натисніть «+ Додати» для декомпозиції' : 'Координатор ще не розбив заявку на підзадачі'} />
        ) : (
          KANBAN_COLS.map((col) => {
            const colTasks = tasks.filter((t) => t.status === col.status);
            if (colTasks.length === 0) return null;
            return (
              <View key={col.status} style={{ marginHorizontal: 16, marginBottom: 12 }}>
                <View style={styles.colHeader}>
                  <View style={[styles.colDot, { backgroundColor: col.color }]} />
                  <Text style={[styles.colTitle, { color: col.color }]}>{col.label}</Text>
                  <Text style={styles.colCount}>{colTasks.length}</Text>
                </View>
                {colTasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    requestTitle={request.title}
                    onPress={() => navigation.navigate('TaskDetail', { taskId: task.id, requestTitle: request.title })}
                    onRefresh={load}
                    currentUserId={user?.id ?? ''}
                    currentUserName={user?.fullName ?? ''}
                    userRole={user?.systemRole ?? SystemRole.VOLUNTEER}
                  />
                ))}
              </View>
            );
          })
        )}

        {/* Media Viewer Modal */}
        {selectedMedia && (
          <Modal visible={mediaViewerVisible} transparent={true} onRequestClose={() => setMediaViewerVisible(false)}>
            <MediaViewer
              visible={mediaViewerVisible}
              url={selectedMedia.url}
              type={selectedMedia.type as any}
              onClose={() => {
                setMediaViewerVisible(false);
                setSelectedMedia(null);
              }}
            />
          </Modal>
        )}
        {/* Actions */}
        <View style={{ marginHorizontal: 16, marginTop: 8, gap: 8 }}>
          {request.status === RequestStatus.IN_PROGRESS && (canManage || canSubmitReview) && (
            <Button
              title="Відправити на перевірку"
              onPress={async () => {
                await requestsApi.markAsPendingReview(request.id);
                load();
              }}
            />
          )}

          {(request.status === RequestStatus.PENDING_REVIEW && (canManage || canSubmitReview)) && (
            <View style={{ gap: 8 }}>
              {canManage && (
                <Button
                  title="Підтвердити виконання"
                  variant="secondary"
                  onPress={async () => {
                    await requestsApi.confirmCompletion(request.id);
                    load();
                  }}
                />
              )}
              {(canSubmitReview || isAdmin) && (
                <Button
                  title="Скасувати перевірку"
                  variant="danger"
                  onPress={async () => {
                    await requestsApi.returnToProgress(request.id);
                    load();
                  }}
                />
              )}
            </View>
          )}

          {canManage && request.status !== RequestStatus.CANCELLED && request.status !== RequestStatus.COMPLETED && (
            <Button title="Скасувати заявку" variant="danger" onPress={handleCancelRequest} />
          )}
        </View>
      </ScrollView>
    </View>
  );
}

function LocationDisplay({ request }: { request: Request }) {
  const [address, setAddress] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      if (request.latitude == null || request.longitude == null) {
        setLoading(false);
        return;
      }
      try {
        if (request.isLocationHidden) {
          setAddress('Приблизне розташування');
        } else {
          const results = await Location.reverseGeocodeAsync({
            latitude: Number(request.latitude),
            longitude: Number(request.longitude)
          });
          if (results.length > 0) {
            const addr = results[0];
            setAddress([addr.city, addr.region, addr.street].filter(Boolean).join(', '));
          } else {
            setAddress(`${Number(request.latitude).toFixed(4)}, ${Number(request.longitude).toFixed(4)}`);
          }
        }
      } catch {
        setAddress(`${Number(request.latitude).toFixed(4)}, ${Number(request.longitude).toFixed(4)}`);
      } finally {
        setLoading(false);
      }
    })();
  }, [request]);

  if (loading) return <MetaRow icon="📍" label="Місце" value="Завантаження..." />;
  if (request.latitude == null || request.longitude == null) return null;

  const lat = Number(request.latitude);
  const lng = Number(request.longitude);
  const label = encodeURIComponent(request.title);
  const url = Platform.OS === 'ios'
    ? `maps:0,0?q=${label}@${lat},${lng}`
    : `geo:${lat},${lng}?q=${lat},${lng}(${label})`;

  return (
    <TouchableOpacity onPress={() => Linking.openURL(url).catch(() => Linking.openURL(`https://maps.google.com/?q=${lat},${lng}`))}>
      <MetaRow
        icon="📍"
        label="Місце"
        value={`${address || ''} (${lat.toFixed(4)}, ${lng.toFixed(4)}) → відкрити в картах`}
        highlight
      />
    </TouchableOpacity>
  );
}

function MetaRow({ icon, label, value, highlight }: { icon: string; label: string; value: string; highlight?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start', marginBottom: 6 }}>
      <Text style={{ fontSize: 14 }}>{icon}</Text>
      <Text style={{ fontSize: 13, color: Colors.textSecondary, width: 64 }}>{label}:</Text>
      <Text style={{ fontSize: 13, color: highlight ? Colors.primary : Colors.text, flex: 1, fontWeight: highlight ? '600' : '400' }}>{value}</Text>
    </View>
  );
}

function TaskCard({ task, onPress, onRefresh, currentUserId, currentUserName, userRole, requestTitle }: {
  task: Task;
  requestTitle: string;
  onPress: () => void;
  onRefresh: () => void;
  currentUserId: string;
  currentUserName: string;
  userRole: SystemRole;
}) {
  const [actioning, setActioning] = useState(false);
  const { isOffline } = useNetwork();
  // Pending actions hook (includes shared enqueueOfflineAction)
  const { pendingActions, hasAction: hasPendingAction, removePendingAction, refresh: refreshPendingActions, enqueueOfflineAction } = usePendingActions(task.id);

  // Check assignment pendingAction directly from task data (resistant to refresh race conditions)
  const myAssignment = task.assignments?.find((a: any) => a.userId === currentUserId) as any;
  const myAssignmentPending = myAssignment?.pendingAction as string | undefined;

  // isAssigned: consider the user as assigned if either:
  // 1. Status is not 'withdrawn' (normal assignment or pending assign)
  // 2. Status is 'withdrawn' but pendingAction is 'withdraw' (offline withdraw queued — still show withdrawal state until sync)
  // NOTE: pendingAction='assign' also counts as assigned (offline assign in progress)
  const isAssigned = task.assignments?.some((a: any) =>
    a.userId === currentUserId && (
      a.status !== 'withdrawn' ||
      (a.status === 'withdrawn' && a.pendingAction === 'withdraw')
    )
  );

  // Pending: either from usePendingActions hook OR from assignment's pendingAction field
  const pendingAssign = (hasPendingAction('TASK_ASSIGN') || hasPendingAction('TASK_WITHDRAW')) ||
    (myAssignmentPending === 'assign' || myAssignmentPending === 'withdraw');

  // isFull: use countActiveAssignments which excludes pendingAction='assign' from slot count
  const isFull = countActiveAssignments(task.assignments) >= task.neededPeopleCount;
  const st = statusColors[task.status];

  const applyOnlineActionLocally = async (action: 'assign' | 'withdraw') => {
    if (!currentUserId) return;

    await safeWrite(async () => {
      const allTasks = await collections.tasks.query().fetch();
      const localTask = allTasks.find((t: any) => t.serverId === task.id || t.id === task.id);
      const localAssignments = (await collections.taskAssignments.query().fetch()) as any[];
      const existing = localAssignments.find((a: any) => a.taskId === task.id && a.userId === currentUserId);

      if (action === 'assign') {
        if (existing) {
          await existing.update((a: any) => {
            a.status = AssignmentStatus.ASSIGNED;
            a.userName = currentUserName || a.userName || null;
            a.fulfilledRole = a.fulfilledRole ?? null;
            a.assignedAt = Date.now();
            a.isSynced = true;
            a.pendingAction = null;
            a.lastSyncedAt = Date.now();
          });
        } else {
          await collections.taskAssignments.create((a: any) => {
            a.taskId = task.id;
            a.userId = currentUserId;
            a.userName = currentUserName || null;
            a.status = AssignmentStatus.ASSIGNED;
            a.fulfilledRole = null;
            a.assignedAt = Date.now();
            a.isSynced = true;
            a.pendingAction = null;
            a.lastSyncedAt = Date.now();
          });
        }
      } else if (existing) {
        await existing.update((a: any) => {
          a.status = AssignmentStatus.WITHDRAWN;
          a.isSynced = true;
          a.pendingAction = null;
          a.lastSyncedAt = Date.now();
        });
      }

      if (localTask) {
        const updatedAssignments = (await collections.taskAssignments.query().fetch()) as any[];
        const nextAssignments = updatedAssignments.filter((a: any) => a.taskId === task.id);
        const nextCount = countActiveAssignments(nextAssignments);

        await localTask.update((t: any) => {
          t.assignedCount = nextCount;
          t.status = nextCount > 0 ? TaskStatus.IN_PROGRESS : TaskStatus.TODO;
          t.isSynced = true;
          t.pendingAction = null;
          t.lastSyncedAt = Date.now();
        });
      }
    });
  };

  const handleAssign = async () => {
    if (isAssigned) {
      Alert.alert('Відмовитися від задачі?', 'Ви впевнені, що хочете відмовитися?', [
        { text: 'Ні', style: 'cancel' },
        { text: 'Так, відмовитися', style: 'destructive', onPress: async () => {
          setActioning(true);
          try {
            if (isOffline) {
              await enqueueOfflineAction('TASK_WITHDRAW', { taskId: task.id });
              return;
            }
            await tasksApi.withdraw(task.id);
            await applyOnlineActionLocally('withdraw');
            onRefresh();
          } catch (e: any) {
            const isNetworkError = !e.response || e.code === 'ERR_NETWORK' || e.message === 'Network Error';
            if (isNetworkError) {
              await enqueueOfflineAction('TASK_WITHDRAW', { taskId: task.id });
              Alert.alert('📴 Офлайн', 'Мережа зникла. Дію поставлено в чергу синхронізації');
            } else {
              Alert.alert('Помилка', e?.response?.data?.message ?? 'Спробуйте ще раз');
            }
          } finally {
            setActioning(false);
          }
        }},
      ]);
      return;
    }
    // Assign
    if (isOffline) {
      Alert.alert('📴 Офлайн режим', 'Взяти задачу в роботу офлайн?', [
        { text: 'Ні', style: 'cancel' },
        { text: 'Так', onPress: async () => {
          setActioning(true);
          try {
            await enqueueOfflineAction('TASK_ASSIGN', { taskId: task.id, fulfilledRole: null });
          } catch (ei: any) { Alert.alert('Помилка', ei?.message ?? 'Не вдалося'); }
          finally { setActioning(false); }
        }},
      ]);
      return;
    }
    setActioning(true);
    try {
      await tasksApi.assign(task.id);
      await applyOnlineActionLocally('assign');
      onRefresh();
    } catch (e: any) {
      const isNetworkError = !e.response || e.code === 'ERR_NETWORK' || e.message === 'Network Error';
      if (isNetworkError) {
        await enqueueOfflineAction('TASK_ASSIGN', { taskId: task.id, fulfilledRole: null });
        Alert.alert('📴 Офлайн', 'Мережа зникла. Дію поставлено в чергу синхронізації');
      } else {
        Alert.alert('Помилка', e?.response?.data?.message ?? 'Спробуйте ще раз');
      }
    } finally {
      setActioning(false);
    }
  };

  /** Pending action card UI */
  const renderPendingAction = (actionType: string, label: string, variant: 'primary' | 'danger' = 'primary') => {
    const pending = pendingActions.find(a => a.actionType === actionType);
    if (!pending) return null;
    return (
      <View key={actionType} style={[taskStyles.pendingContainer, { borderColor: variant === 'danger' ? Colors.danger : Colors.primary }]}>
        <View style={taskStyles.pendingRow}>
          <Text style={taskStyles.pendingText}>🕒 {label}</Text>
          <TouchableOpacity onPress={async () => { await removePendingAction(pending.id); onRefresh(); }} style={taskStyles.cancelBtn}>
            <Text style={taskStyles.cancelText}>Скасувати</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85}>
      <View style={styles.taskCard}>
        <View style={styles.taskHeader}>
          <Text style={styles.taskTitle} numberOfLines={1}>{task.title}</Text>
          <Badge label={st?.label ?? task.status} colorScheme="status" value={task.status} size="sm" />
        </View>

        <View style={styles.taskMeta}>
          <Text style={styles.taskMetaText}>👥 {task.assignments?.filter((a) => a.status !== 'withdrawn').length ?? 0}/{task.neededPeopleCount}</Text>
          {task.requiredRoles?.filter(Boolean).length > 0 && (
            <Text style={styles.taskMetaText}>🎭 {task.requiredRoles.filter(Boolean).join(', ')}</Text>
          )}
          {!!task.deadline && (
            <Text style={[styles.taskMetaText, { color: Colors.warning }]}>
              ⏰ {new Date(task.deadline).toLocaleDateString('uk-UA')}
            </Text>
          )}
        </View>

        <ProgressBar value={task.assignments?.filter((a) => a.status !== 'withdrawn').length ?? 0} total={task.neededPeopleCount} />

        {/* Only volunteers can take tasks — show also when already assigned (IN_PROGRESS) */}
        {/* Hide button for PENDING_REVIEW tasks (already sent for review) */}
        {(userRole === SystemRole.VOLUNTEER || userRole === SystemRole.COORDINATOR) &&
          (task.status === TaskStatus.TODO || task.status === TaskStatus.IN_PROGRESS || pendingAssign) &&
          task.status !== TaskStatus.PENDING_REVIEW && (
          <>
            {pendingAssign ? (
              // Show pending card — використовуємо актуальний actionType з черги
              // Не покладаємося на isAssigned, який може бути true через pendingAction='assign'
              (() => {
                const actualActionType = hasPendingAction('TASK_ASSIGN') ? 'TASK_ASSIGN' : 'TASK_WITHDRAW';
                const actualLabel = actualActionType === 'TASK_ASSIGN' ? 'Призначення в черзі' : 'Відміна призначення в черзі';
                const actualVariant = actualActionType === 'TASK_ASSIGN' ? 'primary' : 'danger';
                return renderPendingAction(actualActionType, actualLabel, actualVariant);
              })()
            ) : (
              <TouchableOpacity
                style={[styles.assignBtn, isAssigned && styles.assignBtnActive, (isFull && !isAssigned) && styles.assignBtnDisabled]}
                onPress={handleAssign}
                disabled={actioning || (isFull && !isAssigned)}
              >
                <Text style={[styles.assignBtnText, isAssigned && { color: Colors.danger }]}>
                  {actioning ? '...' : isAssigned ? 'Відмовитися' : isFull ? 'Слоти заповнені' : '✋ Взяти в роботу'}
                </Text>
              </TouchableOpacity>
            )}
          </>
        )}
      </View>
    </TouchableOpacity>
  );
}

/* ─── Styles for pending card in TaskCard ─────────────────────────────── */
const taskStyles = StyleSheet.create({
  pendingContainer: {
    marginTop: 8,
    padding: 10,
    borderRadius: 8,
    borderWidth: 1.5,
    backgroundColor: '#FFF8E1',
  },
  pendingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pendingText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#F57C00',
    flex: 1,
    flexWrap: 'wrap',
  },
  cancelBtn: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.7)',
  },
  cancelText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#E65100',
  },
});

const styles = StyleSheet.create({
  urgencyStrip: { height: 4, borderRadius: 2, marginBottom: 12 },
  title: { fontSize: 19, fontWeight: '800', color: Colors.text, marginBottom: 10, lineHeight: 24 },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 },
  description: { fontSize: 14, color: Colors.textSecondary, lineHeight: 20, marginBottom: 12 },
  metaList: { marginTop: 4 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  tag: { backgroundColor: Colors.primaryLight, borderRadius: 12, paddingHorizontal: 8, paddingVertical: 3 },
  tagText: { fontSize: 11, color: Colors.primary, fontWeight: '600' },
  progressHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  progressCount: { fontSize: 16, fontWeight: '700', color: Colors.secondary },
  progressPct: { fontSize: 12, color: Colors.textMuted, marginTop: 4 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: Colors.text },
  kanbanHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, marginTop: 8, marginBottom: 4 },
  addTaskBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: Colors.primaryLight },
  colHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  colDot: { width: 8, height: 8, borderRadius: 4 },
  colTitle: { fontSize: 13, fontWeight: '700' },
  colCount: { marginLeft: 'auto', fontSize: 12, color: Colors.textMuted, backgroundColor: Colors.borderLight, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2 },
  taskCard: {
    backgroundColor: Colors.surface, borderRadius: 12,
    padding: 12, marginBottom: 8,
    borderWidth: 1, borderColor: Colors.borderLight,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 3, elevation: 1,
  },
  headerActionBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  headerActionText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  additionalInfoItem: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
  },
  additionalInfoDate: { fontSize: 11, color: Colors.textMuted, marginBottom: 4 },
  additionalInfoText: { fontSize: 14, color: Colors.text, lineHeight: 20 },
  taskHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 6 },
  taskTitle: { flex: 1, fontSize: 14, fontWeight: '700', color: Colors.text },
  taskMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  taskMetaText: { fontSize: 12, color: Colors.textSecondary },
  assignBtn: {
    marginTop: 8, borderRadius: 8, paddingVertical: 8,
    alignItems: 'center', backgroundColor: Colors.primaryLight,
    borderWidth: 1.5, borderColor: Colors.primary,
  },
  assignBtnActive: { backgroundColor: Colors.dangerLight, borderColor: Colors.danger },
  assignBtnDisabled: { backgroundColor: Colors.borderLight, borderColor: Colors.border },
  assignBtnText: { fontSize: 13, fontWeight: '700', color: Colors.primary },
});
