import { database, collections } from './index';
import { RequestModel } from './models/RequestModel';
import { TaskModel } from './models/TaskModel';
import { ChatMessageModel } from './models/ChatMessageModel';
import { TaskAssignmentModel } from './models/TaskAssignmentModel';
import { TaskReportModel } from './models/TaskReportModel';
import { ActionQueueItem } from './models/ActionQueueItem';
import { requestsApi } from '../api/requests.api';
import { tasksApi } from '../api/tasks.api';
import { taskReportsApi } from '../api/task-reports.api';
import { chatApi } from '../api/chat.api';
import api from '../api/axios';
import { getServerReachable } from '../api/axios';
import { OfflineLogger } from '../utils/offlineLogger';
import NetInfo from '@react-native-community/netinfo';
import { Q } from '@nozbe/watermelondb';
import { refreshAllPendingActions } from '../hooks/usePendingActions';

export class SyncService {
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

  static async sync(userId?: string): Promise<{ pushed: number; pulled: number }> {
    if (this.isSyncing) {
      OfflineLogger.sync('Sync already in progress, skipping');
      return { pushed: 0, pulled: 0 };
    }

    // RATE LIMIT: don't sync if we failed recently (30s cooldown)
    if (this._lastFailedAt && Date.now() - this._lastFailedAt < 30000) {
      OfflineLogger.sync('Sync rate-limited after recent failure');
      return { pushed: 0, pulled: 0 };
    }

    if (!getServerReachable()) {
      OfflineLogger.sync('Server unreachable, skipping sync');
      return { pushed: 0, pulled: 0 };
    }

    this.isSyncing = true;
    OfflineLogger.sync('Starting sync...');

    let pushed = 0;
    let pulled = 0;
    let syncFailed = false;

    try {
      pushed = await this.push();
      pulled = await this.pull(userId);
      this._lastFailedAt = null; // Reset on success
      OfflineLogger.sync(`Sync completed: pushed=${pushed}, pulled=${pulled}`);
    } catch (err) {
      OfflineLogger.sync('Sync error:', err);
      syncFailed = true;
      this._lastFailedAt = Date.now();
    } finally {
      this.isSyncing = false;
    }

    return { pushed, pulled };
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

    if (!getServerReachable()) return 0;

    // 1. New requests
    try {
      const allRequests = (await collections.requests.query().fetch()) as unknown as RequestModel[];
      for (const req of allRequests.filter((r) => !r.isSynced && r.pendingAction === 'create')) {
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
        } catch (err) {
          OfflineLogger.sync(`Push request failed`, err);
        }
      }
    } catch (err) {
      console.warn(err);
    }

    // 2. New tasks
    try {
      const allTasks = (await collections.tasks.query().fetch()) as unknown as TaskModel[];
      for (const task of allTasks.filter((t) => !t.isSynced && t.pendingAction === 'create')) {
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
        } catch (err) {
          OfflineLogger.sync(`Push task failed`, err);
        }
      }
    } catch (err) {
      console.warn(err);
    }

    // 3. Chat messages
    try {
      const allMessages = (await collections.chatMessages.query().fetch()) as unknown as ChatMessageModel[];
      for (const msg of allMessages.filter((m) => !m.isSynced && m.pendingAction === 'send')) {
        try {
          let attachmentUrl = msg.attachmentUrl || undefined;
          if (msg.messageType === 'attachment' && attachmentUrl && !attachmentUrl.startsWith('/uploads') && !attachmentUrl.startsWith('http')) {
            const uploaded = await chatApi.sendFile(msg.chatId, {
              uri: attachmentUrl,
              name: msg.content || `attachment-${msg.id}`,
              type: 'application/octet-stream',
            });
            attachmentUrl = uploaded.url;
          }

          const created = await chatApi.sendMessage(
            msg.chatId,
            msg.content,
            msg.replyToId || undefined,
            attachmentUrl,
            msg.messageType || undefined,
          );
          preparedOps.push(
            msg.prepareUpdate((m: any) => {
              m.serverId = created.id;
              m.isSynced = true;
              m.pendingAction = null;
              m.attachmentUrl = created.attachmentUrl ?? attachmentUrl ?? null;
              m.messageStatus = 'sent';
              m.lastSyncedAt = Date.now();
            })
          );
          count++;
        } catch (err: any) {
          OfflineLogger.sync('Push message failed:', err);
          if (err.response?.status === 403) {
            OfflineLogger.sync(`Removing forbidden message: ${msg.id}`);
            preparedOps.push(msg.prepareMarkAsDeleted());
          }
        }
      }
    } catch (err) {
      console.warn(err);
    }

    // 4. Process action_queue (offline task actions: assign, withdraw, complete)
    try {
      const queueItems = (await collections.actionQueue.query().fetch()) as unknown as ActionQueueItem[];
      // Sort by created_at to maintain order
      queueItems.sort((a, b) => a.createdAt - b.createdAt);
      
      for (const item of queueItems) {
        if (item.retryCount > 3) {
          OfflineLogger.sync(`ActionQueue: max retries exceeded for ${item.actionType}`);
          continue;
        }
        
        try {
          const payload = item.payloadData;
          switch (item.actionType) {
            case 'TASK_ASSIGN': {
              const taskIdStr = (payload as any).taskId || (payload as any).task_id || (payload as any).id;
              const fulfilledRole = (payload as any).fulfilledRole;
              if (!taskIdStr) {
                OfflineLogger.sync(`ActionQueue: TASK_ASSIGN missing taskId, payload:`, JSON.stringify(payload));
                preparedOps.push(item.prepareMarkAsDeleted());
                continue;
              }
              await tasksApi.assign(taskIdStr, fulfilledRole as string);
              break;
            }
            case 'TASK_WITHDRAW': {
              const taskIdStr2 = (payload as any).taskId || (payload as any).task_id || (payload as any).id;
              if (!taskIdStr2) {
                OfflineLogger.sync(`ActionQueue: TASK_WITHDRAW missing taskId, payload:`, JSON.stringify(payload));
                preparedOps.push(item.prepareMarkAsDeleted());
                continue;
              }
              await tasksApi.withdraw(taskIdStr2 as string);
              break;
            }
            case 'TASK_COMPLETE': {
              const taskIdStr3 = (payload as any).taskId || (payload as any).task_id || (payload as any).id;
              if (!taskIdStr3) {
                OfflineLogger.sync(`ActionQueue: TASK_COMPLETE missing taskId, payload:`, JSON.stringify(payload));
                preparedOps.push(item.prepareMarkAsDeleted());
                continue;
              }
              await tasksApi.complete(taskIdStr3 as string);
              break;
            }
            case 'TASK_RETURN_TO_PROGRESS': {
              const taskIdStr4 = (payload as any).taskId || (payload as any).task_id || (payload as any).id;
              if (!taskIdStr4) {
                OfflineLogger.sync(`ActionQueue: TASK_RETURN_TO_PROGRESS missing taskId, payload:`, JSON.stringify(payload));
                preparedOps.push(item.prepareMarkAsDeleted());
                continue;
              }
              await tasksApi.returnToProgress(taskIdStr4 as string);
              break;
            }
            case 'TASK_UPDATE_ASSIGNMENT_STATUS': {
              const taskIdStr5 = (payload as any).taskId || (payload as any).task_id || (payload as any).id;
              const status = (payload as any).status;
              if (!taskIdStr5 || !status) {
                OfflineLogger.sync(`ActionQueue: TASK_UPDATE_ASSIGNMENT_STATUS missing taskId/status, payload:`, JSON.stringify(payload));
                preparedOps.push(item.prepareMarkAsDeleted());
                continue;
              }
              await tasksApi.updateAssignmentStatus(taskIdStr5 as string, status as string);
              break;
            }
            case 'REQUEST_ADD_INFO': {
              const requestId = (payload as any).requestId || (payload as any).request_id || (payload as any).id;
              const text = (payload as any).text;
              const attachments = (payload as any).attachments || [];
              if (!requestId || !text) {
                OfflineLogger.sync(`ActionQueue: REQUEST_ADD_INFO missing requestId/text, payload:`, JSON.stringify(payload));
                preparedOps.push(item.prepareMarkAsDeleted());
                continue;
              }
              await requestsApi.addInfo(requestId as string, text as string, attachments as any[]);
              break;
            }
            case 'TASK_REPORT_CREATE': {
              const taskId = (payload as any).taskId || (payload as any).task_id || (payload as any).id;
              const comment = (payload as any).comment;
              const attachments = (payload as any).attachments || [];
              if (!taskId || !comment) {
                OfflineLogger.sync(`ActionQueue: TASK_REPORT_CREATE missing taskId/comment, payload:`, JSON.stringify(payload));
                preparedOps.push(item.prepareMarkAsDeleted());
                continue;
              }
              await taskReportsApi.create(taskId as string, comment as string, attachments as any[]);
              break;
            }
            default:
              OfflineLogger.sync(`ActionQueue: unknown action type ${item.actionType}`);
          }
          // Success — mark for deletion
          preparedOps.push(item.prepareMarkAsDeleted());
          count++;
        } catch (err: any) {
          const errorStr = String(err);
          OfflineLogger.sync(`ActionQueue: ${item.actionType} failed`, err);
          
          // CONFLICT DETECTION: 409 or "already assigned" error
          const isConflict = err.response?.status === 409 || 
            errorStr.toLowerCase().includes('already assigned') ||
            errorStr.toLowerCase().includes('conflict');
          
          if (isConflict) {
            OfflineLogger.sync(`ActionQueue: CONFLICT detected for ${item.actionType} — another user modified the task`);
            // Remove from queue — conflict resolved by server state
            preparedOps.push(item.prepareMarkAsDeleted());
            // Emit conflict event so UI can refresh
            const payload = item.payloadData;
            this.emit('conflict', { actionType: item.actionType, taskId: (payload as any).taskId });
          } else {
            // Retry later
            preparedOps.push(
              item.prepareUpdate((aq: any) => {
                aq.retryCount = (aq.retryCount || 0) + 1;
                aq.error = errorStr;
              })
            );
          }
        }
      }
    } catch (err) {
      console.warn(err);
    }

    if (preparedOps.length > 0) {
      await this.executeBatch(preparedOps);
      refreshAllPendingActions();
    }
    return count;
  }

  private static async executeBatch(operations: any[]): Promise<void> {
    const CHUNK_SIZE = 500;
    for (let i = 0; i < operations.length; i += CHUNK_SIZE) {
      const chunk = operations.slice(i, i + CHUNK_SIZE);
      await database.write(async () => {
        await database.batch(...chunk);
      });
    }
  }

  private static async pull(userId?: string): Promise<number> {
    OfflineLogger.sync('Pull starting...');
    let count = 0;
    const preparedOperations: any[] = [];
    const loadedIds = new Set<string>();

    // Очищення збережених заявок
    if (userId) {
      try {
        const serverSavedIds = await requestsApi.getSavedIds();
        const serverIdSet = new Set(serverSavedIds);
        const localSaved = (await collections.savedRequests.query().fetch()) as any[];
        for (const localReq of localSaved) {
          if (!serverIdSet.has(localReq.id)) {
            preparedOperations.push(localReq.prepareMarkAsDeleted());
          }
        }
        
        const remoteSaved = await requestsApi.getSaved(100, 0);
        for (const req of remoteSaved) {
          preparedOperations.push(
            collections.savedRequests.prepareCreate((r: any) => {
              r.requestId = req.id;
              r.userId = userId;
              r.savedAt = Date.now();
            })
          );
        }
      } catch (err) {
        OfflineLogger.sync('Sync saved requests error', err);
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
      OfflineLogger.sync('Pull requests error', err);
    }

    const localRequests = (await collections.requests.query().fetch()) as unknown as RequestModel[];
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
    
    for (const reqId of visibleRequestServerIds.slice(0, 50)) {
       try {
         const sTasks = await tasksApi.getByRequest(reqId);
         const localTasks = (await collections.tasks.query(Q.where('request_server_id', reqId)).fetch()) as unknown as TaskModel[];
         const localTasksMap = new Map(localTasks.map(t => [t.serverId, t]));
         
         for (const st of sTasks) {
           activeTaskServerIds.add(st.id);
           const existing = localTasksMap.get(st.id);
           if (existing) {
             if (existing.isSynced) {
               preparedOperations.push(existing.prepareUpdate((t: any) => {
                 t.status = st.status;
                 t.title = st.title;
                 t.chatId = st.chatId ?? null;
                 t.lastSyncedAt = Date.now();
               }));
             }
           } else {
             preparedOperations.push(collections.tasks.prepareCreate((t: any) => {
               t.serverId = st.id;
               t.requestServerId = reqId;
               t.title = st.title;
               t.status = st.status;
               t.chatId = st.chatId ?? null;
               t.isSynced = true;
               t.lastSyncedAt = Date.now();
             }));
           }
         }
       } catch {}
    }

    const allLocalTasks = (await collections.tasks.query().fetch()) as unknown as TaskModel[];
    const validTaskIds = new Set<string>();
    
    for (const lt of allLocalTasks) {
      const isOrphan = lt.isSynced && lt.requestServerId && !visibleRequestServerIds.includes(lt.requestServerId as string);
      const isStale = lt.isSynced && lt.serverId && visibleRequestServerIds.includes(lt.requestServerId!) && !activeTaskServerIds.has(lt.serverId);
      
      if ((isOrphan || isStale) && !lt.pendingAction) {
        preparedOperations.push(lt.prepareMarkAsDeleted());
      } else {
        validTaskIds.add(lt.id);
      }
    }

    const localAssignments = (await collections.taskAssignments.query().fetch()) as unknown as TaskAssignmentModel[];
    for (const la of localAssignments) {
      if (!validTaskIds.has(la.taskId) && !la.pendingAction) {
        preparedOperations.push(la.prepareMarkAsDeleted());
      }
    }

    const localReports = (await collections.taskReports.query().fetch()) as unknown as TaskReportModel[];
    for (const lr of localReports) {
      if (!validTaskIds.has(lr.taskId)) {
        preparedOperations.push(lr.prepareMarkAsDeleted());
      }
    }

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

    try {
      const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const staleUsers = await collections.usersCache.query().fetch();
      for (const u of staleUsers) {
        if ((u as any).cachedAt < weekAgo) {
          preparedOperations.push(u.prepareMarkAsDeleted());
        }
      }
    } catch {}

    await this.executeBatch(preparedOperations);
    return count;
  }

  static async saveRequestOffline(data: any): Promise<RequestModel> {
    return database.write(async () => {
      const req = collections.requests.prepareCreate((r: any) => {
        r.serverId = null;
        r.title = data.title;
        r.isSynced = false;
        r.pendingAction = 'create';
        r.createdAtServer = Date.now();
      });
      await database.batch(req);
      return req as unknown as RequestModel;
    });
  }

  static async saveMessageOffline(data: any): Promise<ChatMessageModel> {
    return database.write(async () => {
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
        m.replyToId = data.replyToId ?? null;
        m.readByRaw = JSON.stringify([]);
        m.deliveredToRaw = JSON.stringify([]);
        m.lastSyncedAt = null;
      });
      await database.batch(msg);
      return msg as unknown as ChatMessageModel;
    });
  }

  static async saveTaskOffline(data: any): Promise<TaskModel> {
    return database.write(async () => {
      const task = collections.tasks.prepareCreate((t: any) => {
        t.serverId = null;
        t.requestId = data.requestId;
        t.requestServerId = data.requestServerId;
        t.title = data.title;
        t.isSynced = false;
        t.pendingAction = 'create';
        t.createdAtServer = Date.now();
      });
      await database.batch(task);
      return task as unknown as TaskModel;
    });
  }
}
