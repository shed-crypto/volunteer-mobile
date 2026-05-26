import { Model } from '@nozbe/watermelondb';
import { field } from '@nozbe/watermelondb/decorators';

/**
 * Офлайн-модель учасника організації (WatermelonDB).
 * Відповідає таблиці `organization_members` у локальній SQLite БД.
 */
export class OrganizationMemberModel extends Model {
  static table = 'organization_members';

  @field('server_id') serverId!: string;
  @field('organization_id') organizationId!: string;
  @field('user_id') userId!: string;
  @field('user_name') userName!: string | null;
  @field('org_role') orgRole!: string;
  @field('is_deputy') isDeputy!: boolean;
  @field('is_active') isActive!: boolean;
  @field('joined_at') joinedAt!: number;
  @field('is_synced') isSynced!: boolean;
  @field('last_synced_at') lastSyncedAt!: number | null;
}