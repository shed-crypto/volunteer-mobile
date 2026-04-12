import { Model } from '@nozbe/watermelondb';
import { field } from '@nozbe/watermelondb/decorators';

/**
 * Кешований профіль користувача для офлайн-відображення.
 * Оновлюється під час синхронізації.
 */
export class UserCacheModel extends Model {
  static table = 'users_cache';

  @field('server_id')       serverId!: string;
  @field('full_name')       fullName!: string;
  @field('email')           email!: string | null;
  @field('system_role')     systemRole!: string;
  @field('clearance_level') clearanceLevel!: string;
  @field('trust_score')     trustScore!: number;
  @field('is_blocked')      isBlocked!: boolean;
  @field('cached_at')       cachedAt!: number;
}
