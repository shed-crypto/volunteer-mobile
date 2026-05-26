import { Model } from '@nozbe/watermelondb';
import { field } from '@nozbe/watermelondb/decorators';

/**
 * Офлайн-модель хабу організації (WatermelonDB).
 * Відповідає таблиці `organization_hubs` у локальній SQLite БД.
 */
export class OrganizationHubModel extends Model {
  static table = 'organization_hubs';

  @field('server_id') serverId!: string;
  @field('organization_id') organizationId!: string;
  @field('name') name!: string;
  @field('description') description!: string | null;
  @field('address') address!: string | null;
  @field('latitude') latitude!: number | null;
  @field('longitude') longitude!: number | null;
  @field('media_url') mediaUrl!: string | null;
  @field('is_public') isPublic!: boolean;
  @field('is_synced') isSynced!: boolean;
  @field('last_synced_at') lastSyncedAt!: number | null;
}