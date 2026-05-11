import { Model } from '@nozbe/watermelondb';
import { field } from '@nozbe/watermelondb/decorators';

/**
 * src/db/models/ActionQueueItem.ts
 *
 * Офлайн-модель елемента черги дій (WatermelonDB).
 * Відповідає таблиці `action_queue` у локальній SQLite БД.
 *
 * Сценарій використання:
 *   Коли пристрій офлайн, будь-яка мутація (зміна статусу задачі,
 *   призначення виконавця тощо) записується в цю чергу.
 *   SyncService обробляє чергу при відновленні мережі, повторюючи
 *   запити до сервера. У разі помилки збільшує retry_count та
 *   записує текст помилки у поле `error`.
 *
 * Приклад action_type: 'UPDATE_TASK_STATUS', 'ASSIGN_TASK', 'SEND_REPORT'
 * Приклад payload: '{"taskId":"abc123","status":"in_progress"}'
 */
export class ActionQueueItem extends Model {
  static table = 'action_queue';

  /**
   * Тип дії — ідентифікатор операції, яку треба виконати.
   * Наприклад: 'UPDATE_TASK_STATUS' | 'ASSIGN_TASK' | 'SEND_REPORT'
   */
  @field('action_type')  actionType!: string;

  /**
   * Серіалізований JSON з параметрами дії.
   * Використовуй геттер `payloadData` для десеріалізованого об'єкта.
   */
  @field('payload')      payloadRaw!: string;

  /** Час постановки в чергу (Unix timestamp, мс) */
  @field('created_at')   createdAt!: number;

  /** Кількість невдалих спроб виконання */
  @field('retry_count')  retryCount!: number;

  /** Текст останньої помилки (null, якщо помилок не було) */
  @field('error') error!: string | null;

  /** Код останньої помилки для класифікації retryable/non-retryable */
  @field('last_error_code') lastErrorCode!: string | null;

  /** Наступний час retry (Unix timestamp, мс) для exponential backoff */
  @field('next_retry_at') nextRetryAt!: number | null;

  /** Зручний геттер — повертає десеріалізований payload */
  get payloadData(): Record<string, unknown> {
    try {
      return JSON.parse(this.payloadRaw || '{}');
    } catch {
      return {};
    }
  }
}
