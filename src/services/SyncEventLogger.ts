/**
 * SyncEventLogger.ts
 * ------------------
 * Слухає події від SyncService та записує їх в sync_events таблицю WatermelonDB.
 * Універсальний логер — може використовуватись не тільки для sync,
 * але й для будь-яких системних подій у майбутньому.
 *
 * Використання (з будь-якого місця):
 *   import { SyncEventLogger } from '../services/SyncEventLogger';
 *   SyncEventLogger.log('sync_success', 'Синхронізація', 'Дані оновлено');
 *   SyncEventLogger.log('offline_enqueue', 'Дію збережено', 'Ви призначили себе на задачу', { taskId: '...' });
 */
import { database, collections } from '../db/index';

export type SyncEventType =
  | 'sync_success'
  | 'sync_error'
  | 'sync_conflict'
  | 'offline_enqueue'
  | 'sync_retry'
  | 'queue_failed';

export class SyncEventLogger {
  private static initialized = false;

  /** Ініціалізувати логер — підписатись на SyncService події */
  static init(): void {
    if (this.initialized) return;
    this.initialized = true;

    // Динамічний імпорт SyncService щоб уникнути циклічних залежностей
    const { SyncService } = require('../db/SyncService');
    SyncService.on('sync-event', (data: { type: SyncEventType; title: string; description?: string; metadata?: any }) => {
      this.log(data.type, data.title, data.description, data.metadata);
    });
  }

  /** Записати подію в локальну БД */
  static async log(
    eventType: SyncEventType,
    title: string,
    description?: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    try {
      await database.write(async () => {
        await collections.syncEvents.create((event: any) => {
          event.eventType = eventType;
          event.title = title;
          event.description = description ?? null;
          event.isError = eventType === 'sync_error' || eventType === 'sync_conflict' || eventType === 'queue_failed';
          event.isRead = false;
          event.createdAt = Date.now();
          event.metadataRaw = metadata ? JSON.stringify(metadata) : null;
        });
      });

      // Обмежити історію до 100 записів
      await this.cleanup();
    } catch (e) {
      console.warn('[SyncEventLogger] Failed to log event:', e);
    }
  }

  /** Видалити всі події */
  static async clearAll(): Promise<void> {
    try {
      const all = await collections.syncEvents.query().fetch();
      await database.write(async () => {
        for (const event of all) {
          await event.destroyPermanently();
        }
      });
    } catch (e) {
      console.warn('[SyncEventLogger] Clear failed:', e);
    }
  }

  /** Отримати кількість непрочитаних подій */
  static async getUnreadCount(): Promise<number> {
    try {
      const all = await collections.syncEvents.query().fetch();
      return all.filter((e: any) => !e.isRead).length;
    } catch {
      return 0;
    }
  }

  /** Позначити всі події як прочитані */
  static async markAllRead(): Promise<void> {
    try {
      const unread = (await collections.syncEvents.query().fetch()).filter((e: any) => !e.isRead);
      if (unread.length === 0) return;
      await database.write(async () => {
        for (const event of unread) {
          await event.update((e: any) => { e.isRead = true; });
        }
      });
    } catch (e) {
      console.warn('[SyncEventLogger] Mark all read failed:', e);
    }
  }

  /** Залишити тільки останні 100 записів */
  private static async cleanup(): Promise<void> {
    try {
      const all = await collections.syncEvents.query().fetch();
      if (all.length > 100) {
        const toDelete = all
          .sort((a: any, b: any) => b.createdAt - a.createdAt)
          .slice(100);
        await database.write(async () => {
          for (const event of toDelete) {
            await event.destroyPermanently();
          }
        });
      }
    } catch {
      // silent fail
    }
  }
}