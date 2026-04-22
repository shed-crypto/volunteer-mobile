import { Model } from '@nozbe/watermelondb';
import { field } from '@nozbe/watermelondb/decorators';
import { TaskModel } from './TaskModel';

export class TaskAssignmentModel extends Model {
  static table = 'task_assignments';

  @field('task_id') taskId!: string;
  @field('user_id') userId!: string;
  @field('status') status!: string;
  @field('fulfilled_role') fulfilledRole!: string | null;
  @field('assigned_at') assignedAt!: number;
  @field('is_synced') isSynced!: boolean;
  @field('pending_action') pendingAction!: string | null;
  @field('last_synced_at') lastSyncedAt!: number | null;

  // Relations
  task: TaskModel;
}
