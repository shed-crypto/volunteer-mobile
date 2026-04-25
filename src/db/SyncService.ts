import { database, collections } from './index';
import { RequestModel } from './models/RequestModel';
import { TaskModel } from './models/TaskModel';
import { ChatMessageModel } from './models/ChatMessageModel';
import { requestsApi } from '../api/requests.api';
import { tasksApi } from '../api/tasks.api';
import { chatApi } from '../api/chat.api';
import api from '../api/axios';
import { getServerReachable } from '../api/axios';
import { OfflineLogger } from '../utils/offlineLogger';

/**
 * SyncService — Offline-First архітектура (NFR-03).
 *
 * ВИПРАВЛЕННЯ ДЕДЛОКУ push():
 * record.update() — це обгортка над database.write().
 * Виклик database.write() всередині database.write() блокує чергу WatermelonDB назавжди.
 *
 * ПРАВИЛО: всі записи через prepareUpdate/prepareCreate + database.batch().
 * Ніколи не викликати record.update() / record.create() всередині database.write().
 */
export class SyncService {
  private static isSyncing = false;

  static async sync(): Promise<{ pushed: number; pulled: number }> {
    if (this.isSyncing) {
      OfflineLogger.sync('Sync already in progress, skipping');
      return { pushed: 0, pulled: 0 };
    }

    // Перевірити чи сервер доступний
    if (!getServerReachable()) {
      OfflineLogger.sync('Server unreachable, skipping sync');
      return { pushed: 0, pulled: 0 };
    }

    this.isSyncing = true;
    OfflineLogger.sync('Starting sync...');

    let pushed = 0;
    let pulled = 0;

    try {
      pushed = await this.push();
      pulled = await this.pull();
      OfflineLogger.sync(`Sync completed: pushed=${pushed}, pulled=${pulled}`);
    } catch (err) {
      OfflineLogger.sync('Sync error:', err);
    } finally {
      this.isSyncing = false;
    }

    return { pushed, pulled };
  }

  // ── PUSH: локальні зміни → сервер ─────────────────────────────────────────
  // ВИПРАВЛЕНО: використовуємо prepareUpdate + database.batch()
  // замість record.update() всередині database.write() (дедлок!).

  private static async push(): Promise<number> {
    let count = 0;
    const preparedOps: any[] = [];

    // Перевірити сервер перед push
    if (!getServerReachable()) {
      OfflineLogger.sync('Push skipped — server unreachable');
      return 0;
    }

    // 1. Нові заявки (created offline)
    try {
      const allRequests = await collections.requests.query().fetch();
      const filteredRequests = allRequests.filter(
        (r: any) => !r.isSynced && r.pendingAction === 'create'
      );

      for (const req of filteredRequests) {
        try {
          const created = await requestsApi.create({
            title: (req as any).title,
            description: (req as any).description ?? undefined,
            category: (req as any).category,
            urgency: (req as any).urgency,
            requiredClearance: (req as any).requiredClearance,
            latitude: (req as any).latitude ?? undefined,
            longitude: (req as any).longitude ?? undefined,
            isLocationHidden: (req as any).isLocationHidden ?? false,
            tags: (req as any).tags ?? [],
          });

          // prepareUpdate() — синхронний, без database.write()!
          preparedOps.push(
            req.prepareUpdate((r: any) => {
              r.serverId = created.id;
              r.isSynced = true;
              r.pendingAction = null;
            })
          );
          count++;
        } catch (err) {
          OfflineLogger.sync(`Push request failed: ${(req as any).title}`, err);
        }
      }
    } catch (err) {
      console.warn('[SyncService] Помилка отримання заявок для синхронізації:', err);
    }

    // 2. Нові задачі (created offline)
    try {
      const allTasks = await collections.tasks.query().fetch();
      const pendingTasks = allTasks.filter(
        (t: any) => !t.isSynced && t.pendingAction === 'create'
      );

      for (const task of pendingTasks) {
        if (!(task as any).requestServerId) continue;
        try {
          const created = await tasksApi.create((task as any).requestServerId, {
            title: (task as any).title,
            description: (task as any).description ?? undefined,
            neededPeopleCount: (task as any).neededPeopleCount,
            requiredRoles: (task as any).requiredRoles,
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
          OfflineLogger.sync(`Push task failed: ${(task as any).title}`, err);
        }
      }
    } catch (err) {
      console.warn('[SyncService] Помилка отримання задач для синхронізації:', err);
    }

    // 3. Повідомлення чату в черзі (sent offline)
    try {
      const allMessages = await collections.chatMessages.query().fetch();
      const pendingMessages = allMessages.filter(
        (m: any) => !m.isSynced && m.pendingAction === 'send'
      );

      for (const msg of pendingMessages) {
        try {
          await api.post(`/chats/${(msg as any).chatId}/messages`, {
            content: (msg as any).content,
          });

          preparedOps.push(
            msg.prepareUpdate((m: any) => {
              m.isSynced = true;
              m.pendingAction = null;
            })
          );
          count++;
        } catch (err) {
          OfflineLogger.sync('Push message failed:', err);
        }
      }
    } catch (err) {
      console.warn('[SyncService] Помилка отримання повідомлень для синхронізації:', err);
    }

    // Один batch — без вкладених database.write()
    if (preparedOps.length > 0) {
      try {
        await database.write(async () => {
          await database.batch(...preparedOps);
        });
        OfflineLogger.sync(`Push completed: ${preparedOps.length} operations`);
      } catch (err) {
        OfflineLogger.sync('Push batch error:', err);
      }
    }

    return count;
  }

  // ── PULL: сервер → локальна БД ────────────────────────────────────────────

  private static async pull(): Promise<number> {
    OfflineLogger.sync('Pull starting...');
    let count = 0;

    // Перевірити сервер перед pull
    if (!getServerReachable()) {
      OfflineLogger.sync('Pull skipped — server unreachable');
      return 0;
    }

    // 1. Завантажуємо ВСІ заявки з сервера
    let serverRequests: any[] = [];
    try {
      serverRequests = await requestsApi.getAll({ limit: 200, offset: 0 });
      OfflineLogger.sync(`Pull: got ${serverRequests.length} requests from server`);
    } catch (err) {
      OfflineLogger.sync('Pull requests error:', err);
      return count;
    }

    // 2. Зчитуємо ВСІ локальні заявки ОДИН РАЗ
    let localRequests: any[] = [];
    try {
      localRequests = await collections.requests.query().fetch();
    } catch (err) {
      OfflineLogger.sync('Pull local requests error:', err);
      return count;
    }

    const localRequestsMap = new Map(localRequests.map((r) => [r.serverId, r]));
    const preparedOperations: any[] = [];

    // 3. Підготовка операцій для заявок
    for (const sr of serverRequests) {
      const existing = localRequestsMap.get(sr.id);
      if (existing) {
        if (existing.isSynced) {
          preparedOperations.push(
            existing.prepareUpdate((r: any) => {
              r.status = sr.status;
              r.title = sr.title;
              r.tagsRaw = JSON.stringify(sr.tags ?? []);
              r.latitude = sr.latitude ?? null;
              r.longitude = sr.longitude ?? null;
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
            r.creatorName = sr.creator?.fullName ?? null;
            r.latitude = sr.latitude ?? null;
            r.longitude = sr.longitude ?? null;
            r.isLocationHidden = sr.isLocationHidden ?? false;
            r.tagsRaw = JSON.stringify(sr.tags ?? []);
            r.createdAtServer = sr.createdAt ? new Date(sr.createdAt).getTime() : null;
            r.isSynced = true;
            r.pendingAction = null;
            r.lastSyncedAt = Date.now();
          })
        );
        count++;
      }
    }

    // 4. Зчитуємо ВСІ локальні задачі ОДИН РАЗ
    let localTasks: any[] = [];
    try {
      localTasks = await collections.tasks.query().fetch();
    } catch (err) {
      OfflineLogger.sync('Pull local tasks error:', err);
    }
    const localTasksMap = new Map(localTasks.map((t) => [t.serverId, t]));

    // 5. Задачі для synced заявок (HTTP поза database.write())
    // Зчитуємо локальні assignments
    let localAssignments: any[] = [];
    try {
      localAssignments = await collections.taskAssignments.query().fetch();
    } catch (err) {
      OfflineLogger.sync('Pull local assignments error:', err);
    }
    const localAssignmentsMap = new Map(localAssignments.map((a) => [a.id, a]));
    
    const syncedRequests = localRequests.filter((r: any) => r.serverId && r.isSynced);
    for (const req of syncedRequests.slice(0, 50)) {
      try {
        const serverTasks = await tasksApi.getByRequest((req as any).serverId);
        for (const st of serverTasks) {
          const existingTask = localTasksMap.get(st.id);
          if (existingTask) {
            if (existingTask.isSynced) {
              preparedOperations.push(
                existingTask.prepareUpdate((t: any) => {
                  t.status = st.status;
                  t.neededPeopleCount = st.neededPeopleCount;
                  t.requiredRolesRaw = JSON.stringify(st.requiredRoles ?? []);
                  t.assignedCount =
                    st.assignments?.filter((a: any) => a.status !== 'withdrawn').length ?? 0;
                  t.lastSyncedAt = Date.now();
                })
              );
              count++;
            }
          } else {
            preparedOperations.push(
              collections.tasks.prepareCreate((t: any) => {
                t.serverId = st.id;
                t.requestServerId = (req as any).serverId;
                t.title = st.title;
                t.description = st.description ?? null;
                t.status = st.status;
                t.neededPeopleCount = st.neededPeopleCount ?? 1;
                t.requiredRolesRaw = JSON.stringify(st.requiredRoles ?? []);
                t.assignedCount =
                  st.assignments?.filter((a: any) => a.status !== 'withdrawn').length ?? 0;
                t.priority = st.priority ?? 0;
                t.deadline = st.deadline ?? null;
                t.isSynced = true;
                t.pendingAction = null;
                t.lastSyncedAt = Date.now();
              })
            );
            count++;
          }
          
          // Зберігаємо assignments для задачі
          if (st.assignments && st.assignments.length > 0) {
            for (const sa of st.assignments) {
              const existingA = localAssignmentsMap.get(sa.id);
              if (existingA) {
                preparedOperations.push(
                  existingA.prepareUpdate((a: any) => {
                    a.status = sa.status;
                    a.fulfilledRole = sa.fulfilledRole ?? null;
                    a.lastSyncedAt = Date.now();
                  })
                );
                count++;
              } else {
                preparedOperations.push(
                  collections.taskAssignments.prepareCreate((a: any) => {
                    a.id = sa.id;
                    a.taskId = st.id;
                    a.userId = sa.userId;
                    a.status = sa.status;
                    a.fulfilledRole = sa.fulfilledRole ?? null;
                    a.assignedAt = sa.assignedAt ? new Date(sa.assignedAt).getTime() : Date.now();
                    a.isSynced = true;
                    a.lastSyncedAt = Date.now();
                  })
                );
                count++;
              }
            }
          }
        }
      } catch (err) {
        OfflineLogger.sync(`Pull tasks error for request ${req.serverId}:`, err);
      }
    }

    // 6. Синхронізація повідомлень чатів
    try {
      const serverChats = await chatApi.getMyChats();
      let localMessages: any[] = [];
      try {
        localMessages = await collections.chatMessages.query().fetch();
      } catch (err) {
        OfflineLogger.sync('Pull local messages error:', err);
      }
      const localMessagesMap = new Map(localMessages.map((m) => [m.serverId, m]));

      for (const chat of serverChats) {
        try {
          const response = await api.get(`/chats/${chat.id}/messages?limit=20`);
          const serverMessages = response.data;

          for (const sm of serverMessages) {
            const existingMsg = localMessagesMap.get(sm.id);
            if (existingMsg) {
              if (existingMsg.isSynced) {
                preparedOperations.push(
                  existingMsg.prepareUpdate((m: any) => {
                    m.content = sm.content;
                    m.sentAt = typeof sm.sentAt === 'string' ? new Date(sm.sentAt).getTime() : sm.sentAt;
                    m.messageStatus = sm.messageStatus || 'sent';
                    m.readByRaw = JSON.stringify(sm.readBy || []);
                    m.deliveredToRaw = JSON.stringify(sm.deliveredTo || []);
                    m.lastSyncedAt = Date.now();
                  })
                );
                count++;
              }
            } else {
              preparedOperations.push(
              collections.chatMessages.prepareCreate((m: any) => {
                m.serverId = sm.id;
                m.chatId = sm.chatId;
                m.senderId = sm.senderId;
                m.senderName = sm.sender?.fullName || null;
                m.content = sm.content;
                m.sentAt = typeof sm.sentAt === 'string' ? new Date(sm.sentAt).getTime() : sm.sentAt;
                m.isSynced = true;
                m.pendingAction = null;
                m.messageStatus = sm.messageStatus || 'sent';
                m.readByRaw = JSON.stringify(sm.readBy || []);
                m.deliveredToRaw = JSON.stringify(sm.deliveredTo || []);
                m.lastSyncedAt = Date.now();
              })
              );
              count++;
            }
          }
        } catch (err) {
          OfflineLogger.sync(`Pull chat error ${chat.id}:`, err);
        }
      }
    } catch (err) {
      console.warn('[SyncService.pull] Помилка при синхронізації чатів:', err);
    }

    // 7. Один database.batch() — атомарно, без вкладених write
    if (preparedOperations.length > 0) {
      OfflineLogger.sync(`Pull: executing ${preparedOperations.length} batch operations...`);
      try {
        await database.write(async () => {
          await database.batch(...preparedOperations);
        });
        OfflineLogger.sync('Pull batch completed successfully');
      } catch (err) {
        OfflineLogger.sync('Pull batch error:', err);
      }
    }

    OfflineLogger.sync(`Pull completed: ${count} records processed`);
    return count;
  }

  // ── Зберегти заявку офлайн ────────────────────────────────────────────────

  static async saveRequestOffline(data: {
    title: string;
    description?: string;
    category: string;
    urgency: string;
    requiredClearance: string;
    latitude?: number;
    longitude?: number;
    isLocationHidden?: boolean;
  }): Promise<RequestModel> {
    return database.write(async () => {
      const req = collections.requests.prepareCreate((r: any) => {
        r.serverId = null;
        r.title = data.title;
        r.description = data.description ?? null;
        r.category = data.category;
        r.urgency = data.urgency;
        r.status = 'open';
        r.requiredClearance = data.requiredClearance;
        r.latitude = data.latitude ?? null;
        r.longitude = data.longitude ?? null;
        r.isLocationHidden = data.isLocationHidden ?? false;
        r.tagsRaw = '[]';
        r.isSynced = false;
        r.pendingAction = 'create';
        r.createdAtServer = Date.now();
        r.lastSyncedAt = null;
      });
      await database.batch(req);
      return req as unknown as RequestModel;
    });
  }

  // ── Зберегти повідомлення офлайн ──────────────────────────────────────────

  static async saveMessageOffline(data: {
    chatId: string;
    senderId: string;
    senderName?: string;
    content: string;
  }): Promise<ChatMessageModel> {
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
        m.messageStatus = 'pending';
        m.readByRaw = '[]';
        m.deliveredToRaw = '[]';
        m.lastSyncedAt = null;
      });
      await database.batch(msg);
      return msg as unknown as ChatMessageModel;
    });
  }

  // ── Зберегти задачу офлайн ────────────────────────────────────────────────

  static async saveTaskOffline(data: {
    requestId: string;
    requestServerId: string | null;
    title: string;
    description?: string;
    neededPeopleCount: number;
    requiredRoles: string[];
    priority?: number;
    deadline?: number | null;
  }): Promise<TaskModel> {
    return database.write(async () => {
      const task = collections.tasks.prepareCreate((t: any) => {
        t.serverId = null;
        t.requestId = data.requestId;
        t.requestServerId = data.requestServerId;
        t.title = data.title;
        t.description = data.description ?? null;
        t.status = 'open';
        t.neededPeopleCount = data.neededPeopleCount;
        t.requiredRolesRaw = JSON.stringify(data.requiredRoles);
        t.assignedCount = 0;
        t.chatId = null;
        t.priority = data.priority || 0;
        t.deadline = data.deadline ?? null;
        t.createdAtServer = Date.now();
        t.isSynced = false;
        t.pendingAction = 'create';
        t.lastSyncedAt = null;
      });
      await database.batch(task);
      return task as unknown as TaskModel;
    });
  }
}
