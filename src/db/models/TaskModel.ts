import { Model } from '@nozbe/watermelondb';
import { field } from '@nozbe/watermelondb/decorators';

/**
 * Офлайн-модель підзадачі (WatermelonDB).
 * Відповідає таблиці `tasks` у локальній SQLite БД.
 */
export class TaskModel extends Model {
  static table = 'tasks';

  @field('server_id')            serverId!: string | null;
  @field('request_id')           requestId!: string;          // WatermelonDB local ID
  @field('request_server_id')    requestServerId!: string | null;
  @field('title')                title!: string;
  @field('description')          description!: string | null;
  @field('status')               status!: string;
  @field('needed_people_count')  neededPeopleCount!: number;
  @field('required_roles')       requiredRolesRaw!: string | null;
  @field('assignments_count')    assignmentsCount!: number;
  @field('chat_id')              chatId!: string | null;
  @field('created_at_server')    createdAtServer!: number | null;
  @field('is_synced')            isSynced!: boolean;
  @field('pending_action')       pendingAction!: string | null;

  get requiredRoles(): string[] {
    try { return JSON.parse(this.requiredRolesRaw || '[]'); } catch { return []; }
  }
}
