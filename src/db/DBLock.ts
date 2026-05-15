/**
 * DBLock.ts
 *
 * Глобальний mutex (lock) для database.write() операцій.
 * Запобігає конкурентним write'ам, які викликають Diagnostic error у WatermelonDB.
 *
 * Особливості:
 * - acquire() з таймаутом (через acquireWithTimeout) — запобігає вічному блокуванню
 * - Кожна операція має ідентифікатор для логування
 * - withLock логує захоплення/звільнення локу
 *
 * Використання:
 *   await DBLock.withLock('myOperation', async () => {
 *     await database.write(async () => { ... });
 *   });
 */

let locked = false;
const queue: Array<{ resolve: () => void; id: string }> = [];
let currentOperationId: string | null = null;

const log = (msg: string) => console.log(`[DB_LOCK] ${msg}`);

export const DBLock = {
  /**
   * Чекає поки lock звільниться, потім захоплює його.
   * Завжди викликайте release() після завершення!
   */
  async acquire(operationId?: string): Promise<void> {
    if (!locked) {
      locked = true;
      currentOperationId = operationId || 'anonymous';
      return;
    }
    const id = operationId || 'anonymous';
    return new Promise<void>((resolve) => {
      queue.push({ resolve, id });
    });
  },

  /** Звільняє lock і запускає наступний запит з черги */
  release(): void {
    const next = queue.shift();
    if (next) {
      locked = true;
      currentOperationId = next.id;
      next.resolve();
    } else {
      locked = false;
      currentOperationId = null;
    }
  },

  /**
   * acquire з таймаутом. Якщо lock не звільнився за timeoutMs — викидає помилку.
   * Це запобігає вічному блокуванню при аваріях.
   */
  async acquireWithTimeout(timeoutMs: number = 10000, operationId?: string): Promise<void> {
    const id = operationId || `acquire_timeout_${Date.now()}`;

    if (!locked) {
      locked = true;
      currentOperationId = id;
      return;
    }

    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = queue.findIndex((q) => q.id === id);
        if (idx !== -1) {
          queue.splice(idx, 1);
        }
        reject(
          new Error(
            `DBLock timeout after ${timeoutMs}ms for "${id}". Current holder: "${currentOperationId}", queue length: ${queue.length}`
          )
        );
      }, timeoutMs);

      queue.push({
        resolve: () => {
          clearTimeout(timer);
          locked = true;
          currentOperationId = id;
          resolve();
        },
        id,
      });
    });
  },

  /**
   * Зручний хелпер: acquire → callback → release + логування
   */
  async withLock(operationId: string, callback: () => Promise<void>): Promise<void> {
    const id = `${operationId}_${Date.now()}`;
    await this.acquire(id);
    log(`acquired "${id}" (queue: ${queue.length})`);
    try {
      await callback();
    } finally {
      log(`released "${id}"`);
      this.release();
    }
  },

  get isLocked(): boolean {
    return locked;
  },

  get currentOperation(): string | null {
    return currentOperationId;
  },

  get queueLength(): number {
    return queue.length;
  },

  /** Скинути lock (тільки для аварійних ситуацій) */
  reset(): void {
    log(`FORCE RESET — releasing ${queue.length} queued operations`);
    locked = false;
    currentOperationId = null;
    queue.length = 0;
  },
};

// Fallback logger for environments where offlineLogger isn't available
let OfflineLogger: { db: (...args: any[]) => void };
try {
  OfflineLogger = require('../utils/offlineLogger').OfflineLogger;
} catch {
  OfflineLogger = {
    db: (...args: any[]) => console.log('[DB_LOCK]', ...args),
  };
}
