/**
 * src/db/index.ts — Ініціалізація WatermelonDB
 */
import { Database } from '@nozbe/watermelondb';
import SQLiteAdapter from '@nozbe/watermelondb/adapters/sqlite';
import { dbSchema } from './schema';
import { RequestModel } from './models/RequestModel';
import { TaskModel } from './models/TaskModel';
import { ChatMessageModel } from './models/ChatMessageModel';
import { UserCacheModel } from './models/UserCacheModel';
import { PendingReport } from './models/PendingReport';
import { ActionQueueItem } from './models/ActionQueueItem';

const adapter = new SQLiteAdapter({
  schema: dbSchema,
  dbName: 'volunteer_help',
  // migrations: migrations, // підключати при оновленні схеми
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
    ChatMessageModel,
    UserCacheModel,
    PendingReport,
    ActionQueueItem,
  ],
});
