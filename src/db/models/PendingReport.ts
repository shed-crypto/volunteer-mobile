import { Model } from '@nozbe/watermelondb';
import { field } from '@nozbe/watermelondb/decorators';

/**
 * src/db/models/PendingReport.ts
 *
 * Офлайн-модель чернетки звіту (WatermelonDB).
 * Відповідає таблиці `pending_reports` у локальній SQLite БД.
 *
 * Сценарій використання:
 *   Волонтер заповнює звіт про виконану задачу без мережі.
 *   Запис зберігається локально (is_sent = false).
 *   При відновленні з'єднання SyncService відправляє звіт на сервер
 *   та позначає запис як відправлений (is_sent = true).
 */
export class PendingReport extends Model {
  static table = 'pending_reports';

  /** Локальний WatermelonDB ID задачі, до якої належить звіт */
  @field('task_id')    taskId!: string;

  /** Текстовий опис виконаної роботи (необов'язковий) */
  @field('text')       text!: string | null;

  /**
   * URI фотографій, збережених на пристрої (JSON-масив рядків).
   * Наприклад: '["file:///storage/photos/1.jpg","file:///storage/photos/2.jpg"]'
   * Використовуй геттер `photoUris` для десеріалізованого масиву.
   */
  @field('photo_uris') photoUrisRaw!: string | null;

  /** Час створення звіту (Unix timestamp, мс) */
  @field('created_at') createdAt!: number;

  /** false — чекає відправки; true — вже надіслано на сервер */
  @field('is_sent')    isSent!: boolean;

  /** Зручний геттер — повертає масив URI без ручного JSON.parse */
  get photoUris(): string[] {
    try {
      return JSON.parse(this.photoUrisRaw || '[]');
    } catch {
      return [];
    }
  }
}
