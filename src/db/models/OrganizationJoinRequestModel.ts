import { Model } from '@nozbe/watermelondb';
import { field } from '@nozbe/watermelondb/decorators';

/**
 * Офлайн-модель заявки на вступ в організацію (WatermelonDB).
 * Відповідає таблиці `organization_join_requests` у локальній SQLite БД.
 */
export class OrganizationJoinRequestModel extends Model {
  static table = 'organization_join_requests';

  @field('server_id') serverId!: string;
  @field('organization_id') organizationId!: string;
  @field('user_id') userId!: string;
  @field('user_name') userName!: string | null;
  @field('message') message!: string | null;
  @field('status') status!: string; // pending | approved | rejected
  @field('reviewed_by') reviewedBy!: string | null;
  @field('review_comment') reviewComment!: string | null;
  @field('reviewed_at') reviewedAt!: number | null;
  @field('is_synced') isSynced!: boolean;
  @field('last_synced_at') lastSyncedAt!: number | null;
}