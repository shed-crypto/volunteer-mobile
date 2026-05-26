import { Model } from '@nozbe/watermelondb';
import { field } from '@nozbe/watermelondb/decorators';

/**
 * Офлайн-модель організації (WatermelonDB).
 * Відповідає таблиці `organizations` у локальній SQLite БД.
 */
export class OrganizationModel extends Model {
  static table = 'organizations';

  @field('server_id') serverId!: string;
  @field('name') name!: string;
  @field('description') description!: string | null;
  @field('logo_url') logoUrl!: string | null;
  @field('parent_org_id') parentOrgId!: string | null;
  @field('is_public') isPublic!: boolean;
  @field('tags_raw') tagsRaw!: string | null; // JSON array
  @field('is_synced') isSynced!: boolean;
  @field('last_synced_at') lastSyncedAt!: number | null;

  /** Зручний геттер для десеріалізованих тегів */
  get tags(): string[] {
    try {
      return JSON.parse(this.tagsRaw || '[]');
    } catch {
      return [];
    }
  }
}