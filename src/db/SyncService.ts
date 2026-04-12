import { database, collections } from './index';
import type { RequestModel }     from './models/RequestModel';
import type { ChatMessageModel } from './models/ChatMessageModel';
import { requestsApi }  from '../api/requests.api';
import { tasksApi }     from '../api/tasks.api';
import api              from '../api/axios';

/**
 * SyncService — Offline-First архітектура (NFR-03).
 *
 * БАГ-ФІКс: pull() тепер також синхронізує TASKS.
 * Раніше tasks ніколи не завантажувались в локальну БД,
 * тому при відкритті заявки офлайн підзадачі були відсутні.
 *
 * Стратегія:
 * 1. PUSH — локальні зміни (is_synced=false) → сервер
 * 2. PULL — сервер → локальна БД (requests + tasks + messages)
 */
export class SyncService {
  private static isSyncing = false;

  static async sync(): Promise<{ pushed: number; pulled: number }> {
    if (this.isSyncing) return { pushed: 0, pulled: 0 };
    this.isSyncing = true;

    let pushed = 0;
    let pulled = 0;

    try {
      pushed = await this.push();
      pulled = await this.pull();
    } catch (err) {
      console.warn('[SyncService] Помилка синхронізації:', err);
    } finally {
      this.isSyncing = false;
    }

    return { pushed, pulled };
  }

  // ── PUSH: локальні зміни → сервер ─────────────────────────────────────────

  private static async push(): Promise<number> {
    let count = 0;

    // 1. Нові заявки (created offline)
    const pendingRequests = await collections.requests
      .query()
      .fetch()
      .then((all) => all.filter((r) => !r.isSynced && r.pendingAction === 'create'));

    for (const req of pendingRequests) {
      try {
        const created = await requestsApi.create({
          title:             req.title,
          description:       req.description ?? undefined,
          category:          req.category as any,
          urgency:           req.urgency as any,
          requiredClearance: req.requiredClearance as any,
          latitude:          req.latitude ?? undefined,
          longitude:         req.longitude ?? undefined,
          isLocationHidden:  req.isLocationHidden,
          tags:              req.tags,
        });
        await database.write(async () => {
          await req.update((r) => {
            r.serverId      = created.id;
            r.isSynced      = true;
            r.pendingAction = null;
          });
        });
        count++;
      } catch (err) {
        console.warn(`[SyncService] Не вдалося push заявку "${req.title}":`, err);
      }
    }

    // 2. Нові задачі (created offline)
    const pendingTasks = await collections.tasks
      .query()
      .fetch()
      .then((all) => all.filter((t) => !t.isSynced && t.pendingAction === 'create'));

    for (const task of pendingTasks) {
      if (!task.requestServerId) continue;
      try {
        const created = await tasksApi.create(task.requestServerId, {
          title:             task.title,
          description:       task.description ?? undefined,
          neededPeopleCount: task.neededPeopleCount,
          requiredRoles:     task.requiredRoles,
        });
        await database.write(async () => {
          await task.update((t) => {
            t.serverId      = created.id;
            t.isSynced      = true;
            t.pendingAction = null;
          });
        });
        count++;
      } catch (err) {
        console.warn(`[SyncService] Не вдалося push задачу "${task.title}":`, err);
      }
    }

    // 3. Повідомлення чату в черзі (sent offline)
    const pendingMessages = await collections.chatMessages
      .query()
      .fetch()
      .then((all) => all.filter((m) => !m.isSynced && m.pendingAction === 'send'));

    for (const msg of pendingMessages) {
      try {
        await api.post(`/chats/${msg.chatId}/messages`, { content: msg.content });
        await database.write(async () => {
          await msg.update((m) => {
            m.isSynced      = true;
            m.pendingAction = null;
          });
        });
        count++;
      } catch (err) {
        console.warn(`[SyncService] Не вдалося надіслати повідомлення:`, err);
      }
    }

    return count;
  }

  // ── PULL: сервер → локальна БД ────────────────────────────────────────────

  private static async pull(): Promise<number> {
    let count = 0;

    // 1. Завантажуємо заявки
    try {
      const serverRequests = await requestsApi.getAll({ limit: 200, offset: 0 });

      await database.write(async () => {
        for (const sr of serverRequests) {
          const existing = await collections.requests
            .query()
            .fetch()
            .then((all) => all.find((r) => r.serverId === sr.id));

          if (existing) {
            if (existing.isSynced) {
              await existing.update((r) => {
                r.status    = sr.status;
                r.title     = sr.title;
                r.tagsRaw   = JSON.stringify(sr.tags ?? []);
                r.latitude  = sr.latitude  ?? null;
                r.longitude = sr.longitude ?? null;
              });
              count++;
            }
          } else {
            await collections.requests.create((r) => {
              r.serverId          = sr.id;
              r.title             = sr.title;
              r.description       = sr.description ?? null;
              r.category          = sr.category;
              r.urgency           = sr.urgency;
              r.status            = sr.status;
              r.requiredClearance = sr.requiredClearance ?? 'local';
              r.creatorId         = sr.creatorId ?? null;
              r.creatorName       = sr.creator?.fullName ?? null;
              r.latitude          = sr.latitude  ?? null;
              r.longitude         = sr.longitude ?? null;
              r.isLocationHidden  = sr.isLocationHidden ?? false;
              r.tagsRaw           = JSON.stringify(sr.tags ?? []);
              r.createdAtServer   = sr.createdAt ? new Date(sr.createdAt).getTime() : null;
              r.isSynced          = true;
              r.pendingAction     = null;
            });
            count++;
          }
        }
      });
    } catch (err) {
      console.warn('[SyncService] Pull заявок завершився помилкою:', err);
    }

    // 2. БАГ-ФІКс: Завантажуємо TASKS для кожної заявки
    // Це виправляє: при відкритті заявки офлайн — підзадачі були відсутні
    try {
      const allRequests = await collections.requests.query().fetch();
      const syncedRequests = allRequests.filter((r) => r.serverId && r.isSynced);

      // Беремо лише перші 50 (найновіші) щоб не перевантажувати
      const toSync = syncedRequests.slice(0, 50);

      for (const req of toSync) {
        if (!req.serverId) continue;
        try {
          const serverTasks = await tasksApi.getByRequest(req.serverId);

          await database.write(async () => {
            for (const st of serverTasks) {
              const existingTask = await collections.tasks
                .query()
                .fetch()
                .then((all) => all.find((t) => t.serverId === st.id));

              if (existingTask) {
                if (existingTask.isSynced) {
                  await existingTask.update((t) => {
                    t.status             = st.status;
                    t.neededPeopleCount  = st.neededPeopleCount;
                    t.requiredRolesRaw   = JSON.stringify(st.requiredRoles ?? []);
                    t.assignedCount      = st.assignments?.filter(
                      (a: any) => a.status !== 'withdrawn'
                    ).length ?? 0;
                  });
                  count++;
                }
              } else {
                await collections.tasks.create((t) => {
                  t.serverId           = st.id;
                  t.requestServerId    = req.serverId;
                  t.title              = st.title;
                  t.description        = st.description ?? null;
                  t.status             = st.status;
                  t.neededPeopleCount  = st.neededPeopleCount ?? 1;
                  t.requiredRolesRaw   = JSON.stringify(st.requiredRoles ?? []);
                  t.assignedCount      = st.assignments?.filter(
                    (a: any) => a.status !== 'withdrawn'
                  ).length ?? 0;
                  t.priority           = st.priority ?? 0;
                  t.isSynced           = true;
                  t.pendingAction      = null;
                });
                count++;
              }
            }
          });
        } catch {
          // Конкретна заявка могла бути видалена — ігноруємо
        }
      }
    } catch (err) {
      console.warn('[SyncService] Pull задач завершився помилкою:', err);
    }

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
      return collections.requests.create((r) => {
        r.serverId          = null;
        r.title             = data.title;
        r.description       = data.description ?? null;
        r.category          = data.category;
        r.urgency           = data.urgency;
        r.status            = 'open';
        r.requiredClearance = data.requiredClearance;
        r.latitude          = data.latitude  ?? null;
        r.longitude         = data.longitude ?? null;
        r.isLocationHidden  = data.isLocationHidden ?? false;
        r.tagsRaw           = '[]';
        r.isSynced          = false;
        r.pendingAction     = 'create';
        r.createdAtServer   = Date.now();
      });
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
      return collections.chatMessages.create((m) => {
        m.serverId      = null;
        m.chatId        = data.chatId;
        m.senderId      = data.senderId;
        m.senderName    = data.senderName ?? null;
        m.content       = data.content;
        m.sentAt        = Date.now();
        m.isSynced      = false;
        m.pendingAction = 'send';
      });
    });
  }
}
