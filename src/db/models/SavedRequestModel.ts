import { Model } from '@nozbe/watermelondb';
import { field } from '@nozbe/watermelondb/decorators';

/**
 * Офлайн-модель збереженої заявки (WatermelonDB).
 */
export class SavedRequestModel extends Model {
  static table = 'saved_requests';

  @field('request_id') requestId!: string;
  @field('user_id') userId!: string;
  @field('saved_at') savedAt!: number;
}