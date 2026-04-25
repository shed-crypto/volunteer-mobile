/**
 * src/db/index.ts — Ініціалізація WatermelonDB
 */
import { Database } from '@nozbe/watermelondb';
import SQLiteAdapter from '@nozbe/watermelondb/adapters/sqlite';
import { dbSchema } from './schema';
import { dbMigrations } from './migrations';
import { RequestModel } from './models/RequestModel';
import { TaskModel } from './models/TaskModel';
import { TaskAssignmentModel } from './models/TaskAssignmentModel';
import { ChatMessageModel } from './models/ChatMessageModel';
import { ChatModel } from './models/ChatModel';
import { UserCacheModel } from './models/UserCacheModel';
import { PendingReport } from './models/PendingReport';
import { ActionQueueItem } from './models/ActionQueueItem';

const adapter = new SQLiteAdapter({
  schema: dbSchema,
  migrations: dbMigrations,
  dbName: 'volunteer_help_v10',
  jsi: false,
  onSetUpError: (error) => {
    console.error('[WatermelonDB] Setup error:', error);
  },
});

export const database = new Database({
  adapter,
  modelClasses: [
    RequestModel,
    TaskModel,
    TaskAssignmentModel,
    ChatMessageModel,
    ChatModel,
    UserCacheModel,
    PendingReport,
    ActionQueueItem,
  ],
});

// Export collections for easy access to WatermelonDB collections
export const collections = {
  requests: database.collections.get('requests'),
  tasks: database.collections.get('tasks'),
  taskAssignments: database.collections.get('task_assignments'),
  chatMessages: database.collections.get('chat_messages'),
  chats: database.collections.get('chats'),
  usersCache: database.collections.get('users_cache'),
  pendingReports: database.collections.get('pending_reports'),
  actionQueue: database.collections.get('action_queue'),
};
