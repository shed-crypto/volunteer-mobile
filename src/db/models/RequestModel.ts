import { Model } from '@nozbe/watermelondb';
import { field, date, readonly, json } from '@nozbe/watermelondb/decorators';

/**
 * Офлайн-модель заявки (WatermelonDB).
 * Відповідає таблиці `requests` у локальній SQLite БД.
 */
export class RequestModel extends Model {
  static table = 'requests';

  @field('server_id') serverId!: string | null;
  @field('title') title!: string;
  @field('description') description!: string | null;
  @field('category') category!: string;
  @field('urgency') urgency!: string;
  @field('status') status!: string;
  @field('required_clearance') requiredClearance!: string;
  @field('creator_id') creatorId!: string | null;
  @field('creator_name') creatorName!: string | null;
  @field('latitude') latitude!: number | null;
  @field('longitude') longitude!: number | null;
  @field('is_location_hidden') isLocationHidden!: boolean;
  @field('tags') tagsRaw!: string | null; // stored as JSON string
  @field('deadline') deadline!: number | null;
  @field('created_at_server') createdAtServer!: number | null;
  @field('is_synced') isSynced!: boolean;
  @field('pending_action') pendingAction!: string | null;
  @field('last_synced_at') lastSyncedAt!: number | null; // Додано для відстеження останньої синхронізації
  @field('additional_info_raw') additionalInfoRaw!: string | null; // JSON array of objects
  @field('media_urls_raw') mediaUrlsRaw!: string | null; // JSON array of objects

  /** Зручний геттер для десеріалізованих тегів */
  get tags(): string[] {
    try {
      return JSON.parse(this.tagsRaw || '[]');
    } catch {
      return [];
    }
  }

  /** Зручний геттер для additionalInfo */
  get additionalInfo(): Array<{ id: string; text: string; attachments: any[]; createdAt: Date; updatedAt?: Date }> {
    try {
      return JSON.parse(this.additionalInfoRaw || '[]');
    } catch {
      return [];
    }
  }

  /** Зручний геттер для mediaUrls */
  get mediaUrls(): Array<{ url: string; name: string; type: string }> {
    try {
      return JSON.parse(this.mediaUrlsRaw || '[]');
    } catch {
      return [];
    }
  }
}
