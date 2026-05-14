/**
 * DBLock.ts
 *
 * Глобальний mutex (lock) для database.write() операцій.
 * Запобігає конкурентним write'ам, які викликають Diagnostic error у WatermelonDB.
 *
 * Використання:
 *   await DBLock.acquire();
 *   try {
 *     await database.write(async () => { ... });
 *   } finally {
 *     DBLock.release();
 *   }
 *
 * Або через хелпер:
 *   await DBLock.withLock(async () => {
 *     await database.write(async () => { ... });
 *   });
 */

let locked = false;
const queue: Array<() => void> = [];

export const DBLock = {
  /**
   * Чекає поки lock звільниться, потім захоплює його.
   * Завжди викликайте release() після завершення!
   */
  async acquire(): Promise<void> {
    if (!locked) {
      locked = true;
      return;
    }
    return new Promise<void>((resolve) => {
      queue.push(() => {
        locked = true;
        resolve();
      });
    });
  },

  /** Звільняє lock і запускає наступний запит з черги */
  release(): void {
    const next = queue.shift();
    if (next) {
      next();
    } else {
      locked = false;
    }
  },

  /**
   * Зручний хелпер: acquire → callback → release
   * callback отримує database.write вже всередині acquire/release.
   */
  async withLock(callback: () => Promise<void>): Promise<void> {
    await this.acquire();
    try {
      await callback();
    } finally {
      this.release();
    }
  },

  get isLocked(): boolean {
    return locked;
  },

  /** Скинути lock (тільки для аварійних ситуацій) */
  reset(): void {
    locked = false;
    queue.length = 0;
  },
};