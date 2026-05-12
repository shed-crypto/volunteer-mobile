/**
 * SyncEventModel.ts
 * ---------------
 * WatermelonDB модель для універсальної історії подій.
 * Зберігає події синхронізації, помилки, конфлікти та інші системні сповіщення.
 *
 * eventType:
 *   sync_success        — синхронізація пройшла успішно
 *   sync_error          — помилка синхронізації (мережа або сервер)
 *   sync_conflict       — конфлікт даних (409, "already assigned")
 *   offline_enqueue     — дію поставлено в чергу офлайн
 *   sync_retry          — повторна спроба синхронізації (exponential backoff)
 *   queue_failed        — дія з черги не вдалася (non-retryable)
 */
import { Model } from '@nozbe/watermelondb';
import { field, date, readonly } from '@nozbe/watermelondb/decorators';

export class SyncEventModel extends Model {
  static table = 'sync_events';

  @field('event_type') eventType!: string;
  @field('title') title!: string;
  @field('description') description!: string | null;
  @field('is_error') isError!: boolean;
  @field('is_read') isRead!: boolean;
  @field('created_at') createdAt!: number;
  @field('metadata_raw') metadataRaw!: string | null; // JSON

  /** зручний геттер для метаданих */
  get metadata(): Record<string, unknown> {
    try {
      return this.metadataRaw ? JSON.parse(this.metadataRaw) : {};
    } catch {
      return {};
    }
  }
}