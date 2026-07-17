/**
 * src/services/sync.service.ts — Двобічна синхронізація
 *
 * Алгоритм:
 * 1. PULL: отримати з сервера зміни з lastPulledAt
 * 2. PUSH: відправити локальні зміни на сервер
 * 3. Оновити lastPulledAt у AsyncStorage
 *
 * WatermelonDB має вбудований synchronize() що реалізує цей протокол.
 * Сервер має відповідати формату { changes, timestamp }.
 */
import { synchronize } from '@nozbe/watermelondb/sync';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { database } from '../db';
import api from '../api/axios';

const LAST_PULLED_KEY = 'db_last_pulled_at';

export class SyncService {
  private isSyncing = false;

  /** Виконати синхронізацію (якщо є з'єднання та не виконується інша синхронізація) */
  async sync(): Promise<{ success: boolean; error?: string }> {
    if (this.isSyncing) {
      return { success: false, error: 'Sync already in progress' };
    }

    const netState = await NetInfo.fetch();
    if (!netState.isConnected) {
      return { success: false, error: 'No internet connection' };
    }

    this.isSyncing = true;
    try {
      const lastPulledAt = await this.getLastPulledAt();

      await synchronize({
        database,

        // ─── PULL: отримати зміни з сервера ─────────────────────────────────
        pullChanges: async ({ lastPulledAt: lastPulled }) => {
          const response = await api.get('/sync/pull', {
            params: { lastPulledAt: lastPulled },
          });
          // Сервер повертає: { changes: { requests: {created,updated,deleted}, tasks: {...} }, timestamp }
          return response.data;
        },

        // ─── PUSH: відправити локальні зміни на сервер ───────────────────────
        pushChanges: async ({ changes, lastPulledAt: lastPulled }) => {
          await api.post('/sync/push', { changes, lastPulledAt: lastPulled });
        },

        migrationsEnabledAtVersion: 1,
      });

      await this.saveLastPulledAt(Date.now());
      console.log('[SyncService] Sync completed successfully');
      return { success: true };

    } catch (error: any) {
      console.error('[SyncService] Sync failed:', error?.message);
      return { success: false, error: error?.message || 'Unknown sync error' };
    } finally {
      this.isSyncing = false;
    }
  }

  /** Запустити фоновий моніторинг мережі та синхронізувати при появі з'єднання */
  startNetworkListener(): () => void {
    let prevConnected = false;
    const unsubscribe = NetInfo.addEventListener(async (state) => {
      const isNowConnected = !!state.isConnected;
      if (isNowConnected && !prevConnected) {
        console.log('[SyncService] Network restored — starting sync...');
        await this.sync();
      }
      prevConnected = isNowConnected;
    });
    return unsubscribe;
  }

  private async getLastPulledAt(): Promise<number | null> {
    const val = await AsyncStorage.getItem(LAST_PULLED_KEY);
    return val ? parseInt(val, 10) : null;
  }

  private async saveLastPulledAt(timestamp: number): Promise<void> {
    await AsyncStorage.setItem(LAST_PULLED_KEY, String(timestamp));
  }
}

export const syncService = new SyncService();
