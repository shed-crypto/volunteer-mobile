import { Model } from '@nozbe/watermelondb';
import { field } from '@nozbe/watermelondb/decorators';

/**
 * Офлайн-модель звіту по задачі (WatermelonDB).
 * Зберігає історію звітів для перегляду offline.
 */
export class TaskReportModel extends Model {
  static table = 'task_reports';

  @field('server_id') serverId!: string | null;
  @field('task_id') taskId!: string;
  @field('user_id') userId!: string;
  @field('user_name') userName!: string | null;
  @field('comment') comment!: string;
  @field('attachments_raw') attachmentsRaw!: string | null; // JSON array
  @field('created_at') createdAt!: number;
  @field('is_synced') isSynced!: boolean;
  @field('last_synced_at') lastSyncedAt!: number | null;

  get attachments(): Array<{ url: string; type: string; name: string }> {
    try {
      return JSON.parse(this.attachmentsRaw || '[]');
    } catch {
      return [];
    }
  }
}
