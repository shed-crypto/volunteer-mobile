import { Model } from '@nozbe/watermelondb';
import { field } from '@nozbe/watermelondb/decorators';

export class TaskModel extends Model {
  static table = 'tasks';

  @field('server_id') serverId!: string | null;
  @field('request_id') requestId!: string;
  @field('request_server_id') requestServerId!: string | null;
  @field('title') title!: string;
  @field('description') description!: string | null;
  @field('status') status!: string;
  @field('needed_people_count') neededPeopleCount!: number;
  @field('required_roles') requiredRolesRaw!: string | null;
  @field('assigned_count') assignedCount!: number;
  @field('priority') priority!: number;
  @field('deadline') deadline!: number | null;
  @field('created_at_server') createdAtServer!: number | null;
  @field('pending_action') pendingAction!: string | null;
  @field('last_synced_at') lastSyncedAt!: number | null;
  @field('is_synced') isSynced!: boolean;
  @field('chat_id') chatId!: string | null;

  get requiredRoles(): string[] {
    try {
      return JSON.parse(this.requiredRolesRaw || '[]');
    } catch {
      return [];
    }
  }
  
  // Relations
  taskAssignments: any;
}

