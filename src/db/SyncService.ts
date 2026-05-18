import { database, collections, safeWrite } from './index';
import { DBLock } from './DBLock';
import { countActiveAssignments } from './helpers/assignments';
import { clearPendingActionsForTask, refreshAllPendingActions } from '../hooks/usePendingActions';
import { RequestModel } from './models/RequestModel';
import { TaskModel } from './models/TaskModel';
import { ChatMessageModel } from './models/ChatMessageModel';
import { TaskAssignmentModel } from './models/TaskAssignmentModel';
import { TaskReportModel } from './models/TaskReportModel';
import { ActionQueueItem } from './models/ActionQueueItem';
import { requestsApi } from '../api/requests.api';
import { tasksApi } from '../api/tasks.api';
import { chatApi } from '../api/chat.api';
import api from '../api/axios';
import { getServerReachable } from '../api/axios';
import { OfflineLogger } from '../utils/offlineLogger';
import NetInfo from '@react-native-community/netinfo';
import { Q } from '@nozbe/watermelondb';

export class SyncService {
  static get isRunning(): boolean {
    return SyncService.isSyncing;
  }
  private static isSyncing = false;
  private static _lastFailedAt: number | null = null;
  private static _listeners: Map<string, ((data: any) => void)[]> = new Map();

  static on(event: string, cb: (data: any) => void): () => void {
    if (!this._listeners.has(event)) this._listeners.set(event, []);
    this._listeners.get(event)!.push(cb);
    return () => {
      this._listeners.set(event, this._listeners.get(event)!.filter((f) => f !== cb));
    };
  }

  static emit(event: string, data?: any): void {
    (this._listeners.get(event) || []).forEach((cb) => cb(data));
  }

  static off(event: string, cb: (data: any) => void): void {
    this._listeners.set(event, (this._listeners.get(event) || []).filter((f) => f !== cb));
  }

  static async sync(userId?: string, force = false): Promise<{ pushed: number; pulled: number }> {
    if (this.isSyncing) {
      OfflineLogger.sync('Sync already in progress, skipping');
      return { pushed: 0, pulled: 0 };
    }

    // RATE LIMIT: skip cooldown if force=true
    if (!force && this._lastFailedAt && Date.now() - this._lastFailedAt < 30000) {
      OfflineLogger.sync('Sync rate-limited after recent failure');
      return { pushed: 0, pulled: 0 };
    }

    if (!getServerReachable()) {
      OfflineLogger.sync('Server unreachable, skipping sync');
      return { pushed: 0, pulled: 0 };
    }

    this.isSyncing = true;
    const startedAt = Date.now();
    OfflineLogger.sync(`=== SYNC START (force=${force}) ===`);

    let pushed = 0;
    let pulled = 0;
    let syncFailed = false;

    try {
      pushed = await this.push();
      pulled = await this.pull(userId);
      this._lastFailedAt = null; // Reset on success

      const elapsed = Date.now() - startedAt;
      OfflineLogger.sync(`=== SYNC DONE in ${elapsed}ms: pushed=${pushed}, pulled=${pulled} ===`);
      if (pushed > 0 || pulled > 0) {
        this.emit('sync-event', {
          type: 'sync_success',
          title: 'Синхронізація',
          description: `Оновлено: ${pushed} дій відправлено, ${pulled} записів отримано`,
          metadata: { pushed, pulled, elapsed },
        });
      }
    } catch (err) {
      OfflineLogger.sync('Sync error:', err);
      syncFailed = true;
      this._lastFailedAt = Date.now();
      this.emit('sync-event', {
        type: 'sync_error',
        title: 'Помилка синхронізації',
        description: 'Не вдалося синхронізувати дані з сервером. Спробуйте пізніше.',
        metadata: { error: String(err) },
      });
    } finally {
      this.isSyncing = false;
    }

    return { pushed, pulled };
  }

  private static getActionLabel(actionType: string): string {
    const labels: Record<string, string> = {
      'TASK_ASSIGN': 'призначити вас на задачу',
      'TASK_WITHDRAW': 'скасувати призначення',
      'TASK_COMPLETE': 'завершити задачу',
      'TASK_RETURN_TO_PROGRESS': 'повернути задачу в роботу',
    };
    return labels[actionType] || 'виконати дію';
  }

  static async forceSync(userId?: string): Promise<{ pushed: number; pulled: number }> {
    OfflineLogger.sync('Force sync requested - resetting cooldown');
    this._lastFailedAt = null; // Reset cooldown
    return this.sync(userId, true);
  }

  static startNetworkListener(userId?: string): () => void {
    let prevConnected = false;
    const unsub = NetInfo.addEventListener(async (state) => {
      const isNowConnected = !!state.isConnected;
      if (isNowConnected && !prevConnected) {
        OfflineLogger.sync('Network restored — auto sync starting');
        await this.sync(userId);
      }
      prevConnected = isNowConnected;
    });
    return unsub;
  }

  private static async push(): Promise<number> {
    let count = 0;
    const preparedOps: any[] = [];
    const pushStartedAt = Date.now();

    if (!getServerReachable()) return 0;

    // 1. New requests
    try {
      const allRequests = (await collections.requests.query().fetch()) as unknown as RequestModel[];
      const unsyncedRequests = allRequests.filter((r) => !r.isSynced && r.pendingAction === 'create');
      OfflineLogger.sync(`[PUSH] Found ${unsyncedRequests.length} unsynced requests`);
      for (const req of unsyncedRequests) {
        try {
          const created = await requestsApi.create({
            title: req.title,
            description: req.description ?? undefined,
            category: req.category as any,
            urgency: req.urgency as any,
            requiredClearance: req.requiredClearance as any,
            latitude: req.latitude ?? undefined,
            longitude: req.longitude ?? undefined,
            isLocationHidden: req.isLocationHidden ?? false,
          });
          preparedOps.push(
            req.prepareUpdate((r: any) => {
              r.serverId = created.id;
              r.isSynced = true;
              r.pendingAction = null;
            })
          );
          count++;
          OfflineLogger.sync(`[PUSH] Created request "${req.title}" → serverId=${created.id}`);
        } catch (err) {
          OfflineLogger.sync(`[PUSH] Request push failed: ${req.title}`, err);
        }
      }
    } catch (err) {
      console.warn(err);
    }

    // 2. New tasks
    try {
      const allTasks = (await collections.tasks.query().fetch()) as unknown as TaskModel[];
      const unsyncedTasks = allTasks.filter((t) => !t.isSynced && t.pendingAction === 'create');
      OfflineLogger.sync(`[PUSH] Found ${unsyncedTasks.length} unsynced tasks`);
      for (const task of unsyncedTasks) {
        if (!task.requestServerId) continue;
        try {
          const created = await tasksApi.create(task.requestServerId, {
            title: task.title,
            description: task.description ?? undefined,
            neededPeopleCount: task.neededPeopleCount,
            requiredRoles: task.requiredRoles,
          });
          preparedOps.push(
            task.prepareUpdate((t: any) => {
              t.serverId = created.id;
              t.isSynced = true;
              t.pendingAction = null;
            })
          );
          count++;
          OfflineLogger.sync(`[PUSH] Created task "${task.title}" → serverId=${created.id}`);
        } catch (err) {
          OfflineLogger.sync(`[PUSH] Task push failed: ${task.title}`, err);
        }
      }
    } catch (err) {
      console.warn(err);
    }

    // 3. Chat messages
    try {
      const allMessages = (await collections.chatMessages.query().fetch()) as unknown as ChatMessageModel[];
      const unsyncedMessages = allMessages.filter((m) => !m.isSynced && m.pendingAction === 'send');
      OfflineLogger.sync(`[PUSH] Found ${unsyncedMessages.length} unsynced messages`);
      for (const msg of unsyncedMessages) {
        try {
          const response = await api.post(`/chats/${msg.chatId}/messages`, { content: msg.content });
          const createdMsgId = response.data?.id || response.data?._id;
          preparedOps.push(
            msg.prepareUpdate((m: any) => {
              if (createdMsgId) m.serverId = createdMsgId;
              m.isSynced = true;
              m.pendingAction = null;
              m.messageStatus = 'sent';
              m.lastSyncedAt = Date.now();
            })
          );
          count++;
        } catch (err: any) {
          OfflineLogger.sync(`[PUSH] Message push failed`, err);
          if (err.response?.status === 403) {
            OfflineLogger.sync(`[PUSH] Removing forbidden message: ${msg.id}`);
            preparedOps.push(msg.prepareMarkAsDeleted());
          }
        }
      }
    } catch (err) {
      console.warn(err);
    }

    // 4. Process action_queue (offline task actions: assign, withdraw, complete)
    const processedTaskIds: string[] = [];
    try {
      const now = Date.now();
      const allQueueItems = (await collections.actionQueue.query().fetch()) as unknown as ActionQueueItem[];

      // Sort by next_retry_at (ready items first, then oldest)
      allQueueItems.sort((a, b) => {
        const aReady = a.nextRetryAt ? Math.max(0, a.nextRetryAt - now) : 0;
        const bReady = b.nextRetryAt ? Math.max(0, b.nextRetryAt - now) : 0;
        return aReady - bReady;
      });

      OfflineLogger.sync(`[PUSH] Processing ${allQueueItems.length} action queue items`);

      for (const item of allQueueItems) {
        if (item.retryCount >= 5) { // max 5 retries (2s→5m backoff)
          OfflineLogger.sync(`[PUSH] ActionQueue: max retries exceeded for ${item.actionType} (retryCount=${item.retryCount}), removing`);
          preparedOps.push(item.prepareMarkAsDeleted());
          continue;
        }

        // Check if next_retry_at has passed or is not set
        const readyToRetry = !item.nextRetryAt || now >= item.nextRetryAt;
        if (!readyToRetry) {
          continue;
        }

        try {
          const payload = item.payloadData;
          switch (item.actionType) {
            case 'TASK_ASSIGN': {
              const taskIdStr = (payload as any).taskId || (payload as any).task_id || (payload as any).id;
              const fulfilledRole = (payload as any).fulfilledRole;
              if (!taskIdStr) {
                OfflineLogger.sync(`[PUSH] ActionQueue: TASK_ASSIGN missing taskId, payload:`, JSON.stringify(payload));
                preparedOps.push(item.prepareMarkAsDeleted());
                continue;
              }
              OfflineLogger.sync(`[PUSH] Sending TASK_ASSIGN for task ${taskIdStr} (role: ${fulfilledRole})`);
              await tasksApi.assign(taskIdStr, fulfilledRole as string);
              processedTaskIds.push(taskIdStr);
              await this.prepareTaskActionCleanup(taskIdStr, preparedOps);
              break;
            }
            case 'TASK_WITHDRAW': {
              const taskIdStr2 = (payload as any).taskId || (payload as any).task_id || (payload as any).id;
              if (!taskIdStr2) {
                OfflineLogger.sync(`[PUSH] ActionQueue: TASK_WITHDRAW missing taskId, payload:`, JSON.stringify(payload));
                preparedOps.push(item.prepareMarkAsDeleted());
                continue;
              }
              OfflineLogger.sync(`[PUSH] Sending TASK_WITHDRAW for task ${taskIdStr2}`);
              await tasksApi.withdraw(taskIdStr2 as string);
              processedTaskIds.push(taskIdStr2);
              await this.prepareTaskActionCleanup(taskIdStr2, preparedOps);
              break;
            }
            case 'TASK_COMPLETE': {
              const taskIdStr3 = (payload as any).taskId || (payload as any).task_id || (payload as any).id;
              if (!taskIdStr3) {
                OfflineLogger.sync(`[PUSH] ActionQueue: TASK_COMPLETE missing taskId, payload:`, JSON.stringify(payload));
                preparedOps.push(item.prepareMarkAsDeleted());
                continue;
              }
              OfflineLogger.sync(`[PUSH] Sending TASK_COMPLETE for task ${taskIdStr3}`);
              await tasksApi.complete(taskIdStr3 as string);
              processedTaskIds.push(taskIdStr3);
              await this.prepareTaskActionCleanup(taskIdStr3, preparedOps);
              break;
            }
            case 'TASK_RETURN_TO_PROGRESS': {
              const taskIdStr4 = (payload as any).taskId || (payload as any).task_id || (payload as any).id;
              if (!taskIdStr4) {
                OfflineLogger.sync(`[PUSH] ActionQueue: TASK_RETURN_TO_PROGRESS missing taskId, payload:`, JSON.stringify(payload));
                preparedOps.push(item.prepareMarkAsDeleted());
                continue;
              }
              OfflineLogger.sync(`[PUSH] Sending TASK_RETURN_TO_PROGRESS for task ${taskIdStr4}`);
              await tasksApi.returnToProgress(taskIdStr4 as string);
              processedTaskIds.push(taskIdStr4);
              await this.prepareTaskActionCleanup(taskIdStr4, preparedOps);
              break;
            }
            case 'REQUEST_ADD_INFO': {
              const addInfoRequestId = (payload as any).requestId;
              const addInfoText = (payload as any).text;
              const addInfoAttachments = (payload as any).attachments;
              if (!addInfoRequestId || !addInfoText) {
                OfflineLogger.sync(`[PUSH] ActionQueue: REQUEST_ADD_INFO missing requestId/text, payload:`, JSON.stringify(payload));
                preparedOps.push(item.prepareMarkAsDeleted());
                continue;
              }
              OfflineLogger.sync(`[PUSH] Sending REQUEST_ADD_INFO for request ${addInfoRequestId}`);
              // Upload files first if any
              if (addInfoAttachments && Array.isArray(addInfoAttachments) && addInfoAttachments.length > 0) {
                // Try uploading files — only local files (file:// URI) can be uploaded
                const uploadFormData = new FormData();
                uploadFormData.append('text', addInfoText);
                let hasLocalFiles = false;
                for (const file of addInfoAttachments) {
                  if (file.uri && (file.uri.startsWith('file://') || file.uri.startsWith('/'))) {
                    uploadFormData.append('attachments', { uri: file.uri, name: file.name || 'file', type: file.type || 'application/octet-stream' } as any);
                    hasLocalFiles = true;
                  }
                }
                if (hasLocalFiles) {
                  await api.patch(`/requests/${addInfoRequestId}/add-info`, uploadFormData, {
                    headers: { 'Content-Type': 'multipart/form-data' },
                  });
                } else {
                  await api.patch(`/requests/${addInfoRequestId}/add-info`, { text: addInfoText });
                }
              } else {
                await api.patch(`/requests/${addInfoRequestId}/add-info`, { text: addInfoText });
              }
              break;
            }
            case 'TASK_REPORT_CREATE':
            case 'TASK_REPORT_CREATE_SILENT': {
              const reportTaskId = (payload as any).taskId;
              const reportComment = (payload as any).comment;
              const reportAttachments = (payload as any).attachments;
              if (!reportTaskId) {
                OfflineLogger.sync(`[PUSH] ActionQueue: TASK_REPORT_CREATE missing taskId, payload:`, JSON.stringify(payload));
                preparedOps.push(item.prepareMarkAsDeleted());
                continue;
              }
              OfflineLogger.sync(`[PUSH] Sending TASK_REPORT_CREATE for task ${reportTaskId} (actionType=${item.actionType})`);
              const { taskReportsApi } = await import('../api/task-reports.api');
              await taskReportsApi.create(reportTaskId, reportComment || '', reportAttachments || []);
              processedTaskIds.push(reportTaskId);
              break;
            }
            case 'REQUEST_UPDATE': {
              const updateReqId = (payload as any).requestId;
              const updateData = (payload as any).data;
              const expiresAt = (payload as any).expiresAt || 0;
              if (!updateReqId || !updateData) {
                OfflineLogger.sync(`[PUSH] ActionQueue: REQUEST_UPDATE missing requestId/data, payload:`, JSON.stringify(payload));
                preparedOps.push(item.prepareMarkAsDeleted());
                continue;
              }
              // Check if expired
              if (expiresAt > 0 && Date.now() > expiresAt) {
                OfflineLogger.sync(`[PUSH] ActionQueue: REQUEST_UPDATE expired for request ${updateReqId}, removing from queue`);
                preparedOps.push(item.prepareMarkAsDeleted());
                continue;
              }
              OfflineLogger.sync(`[PUSH] Sending REQUEST_UPDATE for request ${updateReqId}`);
              await requestsApi.update(updateReqId, updateData);
              break;
            }
            default:
              // Handle dynamic TASK_REPORT_CREATE_* action types (e.g. TASK_REPORT_CREATE_1719132834170)
              if (item.actionType.startsWith('TASK_REPORT_CREATE')) {
                const reportTaskId = (payload as any).taskId;
                const reportComment = (payload as any).comment;
                const reportAttachments = (payload as any).attachments;
                if (!reportTaskId) {
                  OfflineLogger.sync(`[PUSH] ActionQueue: TASK_REPORT_CREATE missing taskId, payload:`, JSON.stringify(payload));
                  preparedOps.push(item.prepareMarkAsDeleted());
                  continue;
                }
                OfflineLogger.sync(`[PUSH] Sending TASK_REPORT_CREATE for task ${reportTaskId} (actionType=${item.actionType})`);
                const { taskReportsApi } = await import('../api/task-reports.api');
                await taskReportsApi.create(reportTaskId, reportComment || '', reportAttachments || []);
                processedTaskIds.push(reportTaskId);
              } else {
                OfflineLogger.sync(`[PUSH] ActionQueue: unknown action type ${item.actionType}`);
              }
          }

          // Success — mark for deletion
          preparedOps.push(item.prepareMarkAsDeleted());
          count++;
          OfflineLogger.sync(`[PUSH] ActionQueue: ${item.actionType} succeeded`);
        } catch (err: any) {
          const errorStr = String(err);
          const errorCode = err.response?.status || 'UNKNOWN';
          OfflineLogger.sync(`[PUSH] ActionQueue: ${item.actionType} failed (HTTP ${errorCode})`, err);

          // CONFLICT DETECTION: 409 or "already assigned" error
          const isConflict = err.response?.status === 409 ||
            errorStr.toLowerCase().includes('already assigned') ||
            errorStr.toLowerCase().includes('conflict');

          if (isConflict || this.isNonRetryableError(err)) {
            OfflineLogger.sync(`[PUSH] ActionQueue: ${isConflict ? 'CONFLICT' : 'NON-RETRYABLE'} for ${item.actionType} — removing from queue`);
            preparedOps.push(item.prepareMarkAsDeleted());
            const payload = item.payloadData;

            // Clean up pendingAction immediately
            if (payload) {
              const conflictTaskId = (payload as any).taskId || (payload as any).task_id || (payload as any).id;
              try {
                await safeWrite(async () => {
                  const localAssignments = await collections.taskAssignments.query().fetch();
                  const pendingAssignment = (localAssignments as any[]).find(
                    (a: any) => a.taskId === conflictTaskId && a.pendingAction
                  );
                  if (pendingAssignment) {
                    await pendingAssignment.update((a: any) => {
                      a.pendingAction = null;
                      a.isSynced = true;
                      a.lastSyncedAt = Date.now();
                    });
                  }
                  const allLocalTasks = await collections.tasks.query().fetch();
                  const conflictTask = (allLocalTasks as any[]).find(
                    (t: any) => (t.serverId === conflictTaskId || t.id === conflictTaskId)
                  );
                  if (conflictTask) {
                    await conflictTask.update((t: any) => {
                      t.pendingAction = null;
                      t.isSynced = true;
                      t.lastSyncedAt = Date.now();
                    });
                  }
                });
                OfflineLogger.sync(`[PUSH] Conflict cleanup immediate for task ${conflictTaskId}`);
              } catch (e) {
                OfflineLogger.sync(`[PUSH] Conflict immediate cleanup failed`, e);
                // Fallback: через preparedOps
                try {
                  const localAssignments = await collections.taskAssignments.query().fetch();
                  const pendingAssignment = (localAssignments as any[]).find(
                    (a: any) => a.taskId === conflictTaskId && a.pendingAction
                  );
                  if (pendingAssignment) {
                    preparedOps.push(
                      pendingAssignment.prepareUpdate((a: any) => {
                        a.pendingAction = null;
                        a.isSynced = true;
                        a.lastSyncedAt = Date.now();
                      })
                    );
                  }
                } catch (e2) {
                  OfflineLogger.sync(`[PUSH] Conflict fallback cleanup failed`, e2);
                }
              }
            }

            this.emit('conflict', { actionType: item.actionType, taskId: (payload as any).taskId });
            const eventType = isConflict ? 'sync_conflict' : 'queue_failed' as const;
            this.emit('sync-event', {
              type: eventType,
              title: isConflict ? 'Конфлікт даних' : 'Помилка дії',
              description: isConflict
                ? `Не вдалося ${this.getActionLabel(item.actionType)} — хтось вже зробив це раніше`
                : `Не вдалося ${this.getActionLabel(item.actionType)} — дію скасовано. Зверніться до адміністратора`,
              metadata: { actionType: item.actionType, taskId: (payload as any).taskId, error: errorStr },
            });
          } else {
            // Exponential backoff with jitter
            const backoffMs = Math.min(300000, 2000 * (2 ** item.retryCount)); // 2s,4s,8s,16s,32s... max 5min
            const jitter = Math.random() * 1000; // random 0-1000ms
            const nextRetry = Date.now() + backoffMs + jitter;

            OfflineLogger.sync(`[PUSH] ActionQueue: ${item.actionType} will retry in ${backoffMs + jitter}ms (attempt ${item.retryCount + 1})`);

            preparedOps.push(
              item.prepareUpdate((aq: any) => {
                aq.retryCount = (aq.retryCount || 0) + 1;
                aq.error = errorStr;
                aq.lastErrorCode = errorCode;
                aq.nextRetryAt = nextRetry;
              })
            );
          }
        }
      }
    } catch (err) {
      console.warn(err);
    }

    if (preparedOps.length > 0) {
      try {
        await this.executeBatch(preparedOps, 'push');
      } catch (err: any) {
        OfflineLogger.sync('[PUSH] executeBatch failed after retries, but server actions succeeded', err);
      }
    }

    // Clean up immediate cache AFTER executeBatch (not before!)
    // This ensures action_queue is already empty in DB, so loadPendingActions()
    // will see db=0 and combined with cleared immediate — no pending actions shown.
    if (processedTaskIds.length > 0) {
      for (const id of processedTaskIds) {
        clearPendingActionsForTask(id);
      }
      refreshAllPendingActions();
    }

    const pushElapsed = Date.now() - pushStartedAt;
    OfflineLogger.sync(`[PUSH] Finished in ${pushElapsed}ms: ${count} items pushed, ${preparedOps.length} local ops`);

    return count;
  }

  private static async prepareTaskActionCleanup(taskId: string, preparedOps: any[]): Promise<void> {
    try {
      const localAssignments = await collections.taskAssignments.query().fetch();
      const pendingAssignments = (localAssignments as any[]).filter(
        (assignment: any) => assignment.taskId === taskId && assignment.pendingAction
      );

      for (const assignment of pendingAssignments) {
        preparedOps.push(
          assignment.prepareUpdate((record: any) => {
            record.pendingAction = null;
            record.isSynced = true;
            record.lastSyncedAt = Date.now();
          })
        );
      }

      const localTasks = await collections.tasks.query().fetch();
      const task = (localTasks as any[]).find(
        (record: any) => (record.serverId === taskId || record.id === taskId) && record.pendingAction
      );

      if (task) {
        preparedOps.push(
          task.prepareUpdate((record: any) => {
            record.pendingAction = null;
            record.isSynced = true;
            record.lastSyncedAt = Date.now();
          })
        );
      }
    } catch (e) {
      OfflineLogger.sync(`[PUSH] ActionQueue: cleanup pending local state failed for task ${taskId}`, e);
    }
  }

  private static isNonRetryableError(err: any): boolean {
    const status = err.response?.status;
    const message = String(err.response?.data?.message || err.message || '').toLowerCase();

    // Non-retryable errors
    if (status >= 400 && status < 500) {
      return true;
    }

    // Authentication errors
    if (message.includes('unauthorized') || message.includes('forbidden') ||
        message.includes('not found') || message.includes('validation failed')) {
      return true;
    }

    return false;
  }

  /**
   * Health check for server availability
   */
  private static async checkServerHealth(): Promise<boolean> {
    try {
      const response = await api.get('/health/ping', {
        timeout: 5000,
        validateStatus: (status) => status < 500,
      });
      return response.status === 200;
    } catch {
      return false;
    }
  }

  public static async executeBatch(operations: any[], context: string = 'unknown'): Promise<void> {
    if (operations.length === 0) return;

    const CHUNK_SIZE = 500;
    const startedAt = Date.now();
    OfflineLogger.sync(`[DB_BATCH] ${context}: starting ${operations.length} operations in chunks of ${CHUNK_SIZE}`);

    let totalSuccess = 0;
    let totalSkipped = 0;

    for (let i = 0; i < operations.length; i += CHUNK_SIZE) {
      const chunk = operations.slice(i, i + CHUNK_SIZE);
      const chunkIdx = Math.floor(i / CHUNK_SIZE) + 1;
      const totalChunks = Math.ceil(operations.length / CHUNK_SIZE);

      try {
        // Use DBLock with timeout to prevent deadlocks with other write operations
        await DBLock.withLock(`executeBatch_${context}_chunk${chunkIdx}`, async () => {
          await database.write(async () => {
            await database.batch(...chunk);
          });
        });
        totalSuccess += chunk.length;
        OfflineLogger.sync(`[DB_BATCH] ${context}: chunk ${chunkIdx}/${totalChunks} OK (${chunk.length} ops)`);
      } catch (err: any) {
        OfflineLogger.sync(`[DB_BATCH] ${context}: chunk ${chunkIdx}/${totalChunks} FAILED (${chunk.length} ops)`, err);

        // Try each operation individually with detailed logging
        let individualSuccesses = 0;
        let individualFailures = 0;
        for (let opIdx = 0; opIdx < chunk.length; opIdx++) {
          const op = chunk[opIdx];
          try {
            // Log the operation type and details before executing
            const opDetails = this.describeOperation(op, i + opIdx);
            OfflineLogger.sync(`[DB_BATCH] ${context}: attempting op ${i + opIdx + 1}/${operations.length} — ${opDetails}`);

            await DBLock.withLock(`executeBatch_${context}_single`, async () => {
              await database.write(async () => {
                await database.batch(op);
              });
            });
            individualSuccesses++;
            OfflineLogger.sync(`[DB_BATCH] ${context}: op ${i + opIdx + 1} SUCCESS`);
          } catch (opErr: any) {
            individualFailures++;
            const opDetails = this.describeOperation(op, i + opIdx);
            const errStr = String(opErr?.message || opErr?.name || 'Unknown error');
            OfflineLogger.sync(`[DB_BATCH] ${context}: op ${i + opIdx + 1} FAILED — ${opDetails}`, opErr);
          }
        }
        totalSuccess += individualSuccesses;
        totalSkipped += individualFailures;
        OfflineLogger.sync(`[DB_BATCH] ${context}: chunk ${chunkIdx}/${totalChunks} individual — ${individualSuccesses} ok, ${individualFailures} skipped`);
      }
    }

    const elapsed = Date.now() - startedAt;
    OfflineLogger.sync(`[DB_BATCH] ${context}: FINISHED in ${elapsed}ms — ${totalSuccess} success, ${totalSkipped} skipped`);
  }

  // Helper to describe an operation for logging
  private static describeOperation(op: any, index: number): string {
    try {
      if (!op) return `op[${index}]: null`;
      if (typeof op !== 'object') return `op[${index}]: ${String(op)}`;

      const table = op?.constructor?.table || op?.table || 'unknown';
      const id = op?.id || op?._raw?.id || '?';

      // prepareCreate: модель має _raw._status === 'created'
      if (op._raw?._status === 'created') {
        return `prepareCreate [${table}] id=${id || 'new'}`;
      }
      // prepareMarkAsDeleted або destroyPermanently
      if (op._isDeleted) {
        return `markAsDeleted [${table}] id=${id}`;
      }
      // prepareUpdate: модель має _isEditing = true
      if (op._isEditing) {
        return `prepareUpdate [${table}] id=${id}`;
      }

      return `op[${index}]: ${op.constructor?.name || 'unknown'}`;
    } catch {
      return `op[${index}]: error describing`;
    }
  }

  private static async pull(userId?: string): Promise<number> {
    OfflineLogger.sync(`[PULL] Starting...`);
    const pullStartedAt = Date.now();

    let count = 0;
    const preparedOperations: any[] = [];
    const loadedIds = new Set<string>();

    // Clear saved requests
    if (userId) {
      try {
        const serverSavedIds = await requestsApi.getSavedIds();
        const serverIdSet = new Set(serverSavedIds);
        const localSaved = (await collections.savedRequests.query().fetch()) as any[];

        for (const localReq of localSaved) {
          if (!serverIdSet.has(localReq.requestId)) {
            preparedOperations.push(localReq.prepareMarkAsDeleted());
          }
        }

        const remoteSaved = await requestsApi.getSaved(100, 0);
        const existingSavedIds = new Set(localSaved.map((req: any) => req.requestId));
        for (const req of remoteSaved) {
          if (existingSavedIds.has(req.id)) continue;
          preparedOperations.push(
            collections.savedRequests.prepareCreate((r: any) => {
              r.requestId = req.id;
              r.userId = userId;
              r.savedAt = Date.now();
            })
          );
        }
      } catch (err) {
        OfflineLogger.sync('[PULL] Sync saved requests error', err);
      }
    }

    const serverRequests: any[] = [];
    const addUnique = (items: any[]) => {
      for (const item of items) {
        if (!loadedIds.has(item.id)) {
          loadedIds.add(item.id);
          serverRequests.push(item);
        }
      }
    };

    try {
      if (userId) {
        try { addUnique(await requestsApi.getSaved(50)); } catch {}
        try { addUnique(await requestsApi.getAll({ creatorId: userId, limit: 50 })); } catch {}
      }
      try { addUnique(await requestsApi.getAll({ urgency: 'critical' as any, limit: 50 })); } catch {}
      try { addUnique(await requestsApi.getAll({ limit: 100 })); } catch {}
    } catch (err) {
      OfflineLogger.sync('[PULL] Fetch requests error', err);
    }

    OfflineLogger.sync(`[PULL] Fetched ${serverRequests.length} requests (${loadedIds.size} unique)`);
    if (serverRequests.length > 0) {
      OfflineLogger.sync(`[PULL] Request IDs: ${serverRequests.map((r: any) => r.id).join(', ')}`);
    }

    let localRequests: any[] = [];
    try {
      localRequests = (await collections.requests.query().fetch()) as unknown as RequestModel[];
    } catch (fetchErr: any) {
      OfflineLogger.sync('[PULL] fetch local requests failed', fetchErr);
    }
    const localRequestsMap = new Map(localRequests.map((r) => [r.serverId, r]));

    for (const sr of serverRequests) {
      const existing = localRequestsMap.get(sr.id);
      if (existing) {
        if (existing.isSynced) {
          preparedOperations.push(
            existing.prepareUpdate((r: any) => {
              r.status = sr.status;
              r.title = sr.title;
              r.description = sr.description ?? null;
              r.category = sr.category;
              r.urgency = sr.urgency;
              r.requiredClearance = sr.requiredClearance ?? 'local';
              r.latitude = sr.latitude ?? null;
              r.longitude = sr.longitude ?? null;
              r.isLocationHidden = sr.isLocationHidden ?? false;
              r.tagsRaw = JSON.stringify(sr.tags ?? []);
              r.additionalInfoRaw = JSON.stringify(sr.additionalInfo ?? []);
              r.mediaUrlsRaw = JSON.stringify(sr.mediaUrls ?? []);
              r.reportUrlsRaw = JSON.stringify(sr.reportUrls ?? []);
              r.deadline = sr.deadline ? new Date(sr.deadline).getTime() : null;
              r.lastSyncedAt = Date.now();
            })
          );
          count++;
        }
      } else {
        preparedOperations.push(
          collections.requests.prepareCreate((r: any) => {
            r.serverId = sr.id;
            r.title = sr.title;
            r.description = sr.description ?? null;
            r.category = sr.category;
            r.urgency = sr.urgency;
            r.status = sr.status;
            r.requiredClearance = sr.requiredClearance ?? 'local';
            r.creatorId = sr.creatorId ?? null;
            r.latitude = sr.latitude ?? null;
            r.longitude = sr.longitude ?? null;
            r.isLocationHidden = sr.isLocationHidden ?? false;
            r.tagsRaw = JSON.stringify(sr.tags ?? []);
            r.additionalInfoRaw = JSON.stringify(sr.additionalInfo ?? []);
            r.mediaUrlsRaw = JSON.stringify(sr.mediaUrls ?? []);
            r.reportUrlsRaw = JSON.stringify(sr.reportUrls ?? []);
            r.deadline = sr.deadline ? new Date(sr.deadline).getTime() : null;
            r.createdAtServer = sr.createdAt ? new Date(sr.createdAt).getTime() : Date.now();
            r.isSynced = true;
            r.lastSyncedAt = Date.now();
          })
        );
        count++;
      }
    }

    // Note: We no longer delete local requests based on incomplete server list
    // This prevents data loss when server returns partial results (e.g., limit=100)
    // Deletion should only happen when explicitly confirmed (e.g., 404 from server)

    const visibleRequestServerIds = serverRequests.map((r: any) => r.id);
    const activeTaskServerIds = new Set<string>();
    const CONCURRENCY = 3;

    // Process task fetching in batches to avoid 429 rate limiting
    const reqIds = visibleRequestServerIds.slice(0, 50);
    OfflineLogger.sync(`[PULL] Fetching tasks for ${reqIds.length} requests (concurrency=${CONCURRENCY})`);

    for (let i = 0; i < reqIds.length; i += CONCURRENCY) {
      const batch = reqIds.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map(async (reqId) => {
          const sTasks = await tasksApi.getByRequest(reqId);
          return { reqId, tasks: sTasks };
        })
      );
      for (const result of results) {
        if (result.status === 'rejected') continue;
        const { reqId, tasks: sTasks } = result.value;
        try {
          const localTasks = (await collections.tasks.query(Q.where('request_server_id', reqId)).fetch()) as unknown as TaskModel[];
          const localTasksMap = new Map(localTasks.map(t => [t.serverId, t]));

          // Load existing taskAssignments for dedup
          const existingAssignmentsRaw = await collections.taskAssignments.query().fetch();
          const assignmentsMap = new Map(
            (existingAssignmentsRaw as any[]).map((a: any) => [`${a.taskId}-${a.userId}`, a])
          );

          for (const st of sTasks) {
            activeTaskServerIds.add(st.id);
            const existing = localTasksMap.get(st.id);
            if (existing) {
              if (existing.isSynced) {
                preparedOperations.push(existing.prepareUpdate((t: any) => {
                  t.status = st.status;
                  t.title = st.title;
                  t.description = st.description ?? null;
                  t.neededPeopleCount = st.neededPeopleCount ?? 1;
                  t.requiredRolesRaw = JSON.stringify(st.requiredRoles ?? []);
                  t.assignedCount = countActiveAssignments(st.assignments);
                  t.priority = st.priority ?? 0;
                  t.deadline = st.deadline ? new Date(st.deadline).getTime() : null;
                  t.chatId = st.chatId ?? null;
                  t.lastSyncedAt = Date.now();
                }));
              }
            } else {
          preparedOperations.push(collections.tasks.prepareCreate((t: any) => {
            t.serverId = st.id;
            t.requestId = reqId;
            t.requestServerId = reqId;
            t.title = st.title;
                t.description = st.description ?? null;
                t.status = st.status;
                t.neededPeopleCount = st.neededPeopleCount ?? 1;
                t.requiredRolesRaw = JSON.stringify(st.requiredRoles ?? []);
                t.assignedCount = countActiveAssignments(st.assignments);
                t.priority = st.priority ?? 0;
                t.deadline = st.deadline ? new Date(st.deadline).getTime() : null;
                t.chatId = st.chatId ?? null;
                t.isSynced = true;
                t.lastSyncedAt = Date.now();
              }));
            }

    // Also save/update taskAssignments
            if (st.assignments && Array.isArray(st.assignments)) {
              for (const a of st.assignments) {
                const taskId = a.taskId || st.id;
                const key = `${taskId}-${a.userId}`;
                const existingAssignment = assignmentsMap.get(key);

                if (existingAssignment) {
                  // Do NOT overwrite assignments with local pending changes
                  if (!existingAssignment.pendingAction) {
                    preparedOperations.push(
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
                    OfflineLogger.sync(`[PULL] SKIP assignment update for task ${taskId} user ${a.userId} — has pendingAction`);
                  }
                } else {
                  preparedOperations.push(
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
        } catch {}
      }
    }

    // Clean up orphaned tasks (tasks whose parent request no longer exists on server)
    let allLocalTasks: any[] = [];
    try {
      allLocalTasks = (await collections.tasks.query().fetch()) as unknown as TaskModel[];
    } catch (fetchErr: any) {
      OfflineLogger.sync('[PULL] fetch allLocalTasks failed', fetchErr);
    }
    const validTaskIds = new Set<string>();
    for (const lt of allLocalTasks) {
      const isOrphan = lt.isSynced && lt.requestServerId && !visibleRequestServerIds.includes(lt.requestServerId as string);
      const isStale = lt.isSynced && lt.serverId && visibleRequestServerIds.includes(lt.requestServerId!) && !activeTaskServerIds.has(lt.serverId);

      if ((isOrphan || isStale) && !lt.pendingAction) {
        preparedOperations.push(lt.prepareMarkAsDeleted());
        OfflineLogger.sync(`[PULL] Removing orphan/stale task: ${lt.id} (serverId: ${lt.serverId})`);
      } else {
        validTaskIds.add(lt.id);
        if (lt.serverId) validTaskIds.add(lt.serverId);
      }
    }

    let localAssignments: any[] = [];
    try {
      localAssignments = (await collections.taskAssignments.query().fetch()) as unknown as TaskAssignmentModel[];
    } catch (fetchErr: any) {
      OfflineLogger.sync('[PULL] fetch localAssignments failed', fetchErr);
    }
    for (const la of localAssignments) {
      if (!validTaskIds.has(la.taskId) && !la.pendingAction) {
        preparedOperations.push(la.prepareMarkAsDeleted());
      }
    }

    let localReports: any[] = [];
    try {
      localReports = (await collections.taskReports.query().fetch()) as unknown as TaskReportModel[];
    } catch (fetchErr: any) {
      OfflineLogger.sync('[PULL] fetch localReports failed', fetchErr);
    }
    for (const lr of localReports) {
      if (!validTaskIds.has(lr.taskId)) {
        preparedOperations.push(lr.prepareMarkAsDeleted());
      }
    }

    // Clean up orphaned chat messages
    try {
      const serverChats = await chatApi.getMyChats();
      const activeChatIds = new Set(serverChats.map((c) => c.id));
      const allMessages = (await collections.chatMessages.query().fetch()) as unknown as ChatMessageModel[];

      for (const m of allMessages) {
        if (m.isSynced && !m.pendingAction && !activeChatIds.has(m.chatId)) {
          preparedOperations.push(m.prepareMarkAsDeleted());
        }
      }
    } catch {}

    // Clean stale user cache
    try {
      const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const staleUsers = await collections.usersCache.query().fetch();
      for (const u of staleUsers) {
        if ((u as any).cachedAt < weekAgo) {
          preparedOperations.push(u.prepareMarkAsDeleted());
        }
      }
    } catch {}

    OfflineLogger.sync(`[PULL] Total prepared operations: ${preparedOperations.length} (${count} new/updated)`);

    if (preparedOperations.length > 0) {
      try {
        await this.executeBatch(preparedOperations, 'pull');
      } catch (err: any) {
        OfflineLogger.sync('[PULL] executeBatch failed after retries', err);
      }
    }

    const pullElapsed = Date.now() - pullStartedAt;
    OfflineLogger.sync(`[PULL] Finished in ${pullElapsed}ms: ${count} items updated/created`);

    return count;
  }

  static async saveRequestOffline(data: any): Promise<RequestModel> {
    return safeWrite(async () => {
      const req = collections.requests.prepareCreate((r: any) => {
        r.serverId = null;
        r.title = data.title;
        r.description = data.description ?? null;
        r.category = data.category ?? 'other';
        r.urgency = data.urgency ?? 'medium';
        r.status = data.status ?? 'open';
        r.requiredClearance = data.requiredClearance ?? 'local';
        r.creatorId = data.creatorId ?? null;
        r.creatorName = data.creatorName ?? null;
        r.latitude = data.latitude ?? null;
        r.longitude = data.longitude ?? null;
        r.isLocationHidden = data.isLocationHidden ?? false;
        r.tagsRaw = JSON.stringify(data.tags ?? []);
        r.additionalInfoRaw = JSON.stringify(data.additionalInfo ?? []);
        r.mediaUrlsRaw = JSON.stringify(data.mediaUrls ?? []);
        r.reportUrlsRaw = JSON.stringify(data.reportUrls ?? []);
        r.deadline = data.deadline ? new Date(data.deadline).getTime() : null;
        r.isSynced = false;
        r.pendingAction = 'create';
        r.createdAtServer = Date.now();
        r.lastSyncedAt = null;
      });
      await database.batch(req);
      return req as unknown as RequestModel;
    });
  }

  static async saveMessageOffline(data: any): Promise<ChatMessageModel> {
    return safeWrite(async () => {
      const msg = collections.chatMessages.prepareCreate((m: any) => {
        m.serverId = null;
        m.chatId = data.chatId;
        m.senderId = data.senderId;
        m.senderName = data.senderName ?? null;
        m.content = data.content;
        m.sentAt = Date.now();
        m.isSynced = false;
        m.pendingAction = 'send';
        m.messageType = data.messageType ?? 'text';
        m.attachmentUrl = data.attachmentUrl ?? null;
        m.messageStatus = 'pending';
        m.readByRaw = JSON.stringify([]);
        m.deliveredToRaw = JSON.stringify([]);
        m.replyToId = data.replyToId ?? null;
        m.lastSyncedAt = null;
      });
      await database.batch(msg);
      return msg as unknown as ChatMessageModel;
    });
  }

  static async saveTaskOffline(data: any): Promise<TaskModel> {
    return safeWrite(async () => {
      const task = collections.tasks.prepareCreate((t: any) => {
        t.serverId = null;
        t.requestId = data.requestId;
        t.requestServerId = data.requestServerId;
        t.title = data.title;
        t.description = data.description ?? null;
        t.status = data.status ?? 'todo';
        t.neededPeopleCount = data.neededPeopleCount ?? 1;
        t.requiredRolesRaw = JSON.stringify(data.requiredRoles ?? []);
        t.assignedCount = 0;
        t.priority = data.priority ?? 0;
        t.chatId = data.chatId ?? null;
        t.deadline = data.deadline ? new Date(data.deadline).getTime() : null;
        t.isSynced = false;
        t.pendingAction = 'create';
        t.createdAtServer = Date.now();
        t.lastSyncedAt = null;
      });
      await database.batch(task);
      return task as unknown as TaskModel;
    });
  }
}
