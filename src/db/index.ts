/**
 * src/db/index.ts — Ініціалізація WatermelonDB
 */
import { Database } from '@nozbe/watermelondb';
import SQLiteAdapter from '@nozbe/watermelondb/adapters/sqlite';
import { dbSchema } from './schema';
import { dbMigrations } from './migrations';
import { DBLock } from './DBLock';
import { RequestModel } from './models/RequestModel';
import { TaskModel } from './models/TaskModel';
import { TaskAssignmentModel } from './models/TaskAssignmentModel';
import { ChatMessageModel } from './models/ChatMessageModel';
import { ChatModel } from './models/ChatModel';
import { UserCacheModel } from './models/UserCacheModel';
import { PendingReport } from './models/PendingReport';
import { ActionQueueItem } from './models/ActionQueueItem';
import { SyncEventModel } from './models/SyncEventModel';
import { TaskReportModel } from './models/TaskReportModel';
import { SavedRequestModel } from './models/SavedRequestModel';
import { OrganizationModel } from './models/OrganizationModel';
import { OrganizationMemberModel } from './models/OrganizationMemberModel';
import { OrganizationHubModel } from './models/OrganizationHubModel';
import { OrganizationJoinRequestModel } from './models/OrganizationJoinRequestModel';

const adapter = new SQLiteAdapter({
  schema: dbSchema,
  migrations: dbMigrations,
  dbName: 'volunteer_help_v12',
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
    TaskReportModel,
    SavedRequestModel,
    SyncEventModel,
    OrganizationModel,
    OrganizationMemberModel,
    OrganizationHubModel,
    OrganizationJoinRequestModel,
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
  taskReports: database.collections.get('task_reports'),
  savedRequests: database.collections.get('saved_requests'),
  actionQueue: database.collections.get('action_queue'),
  syncEvents: database.collections.get('sync_events'),
  organizations: database.collections.get('organizations'),
  organizationMembers: database.collections.get('organization_members'),
  organizationHubs: database.collections.get('organization_hubs'),
  organizationJoinRequests: database.collections.get('organization_join_requests'),
};

/**
 * Безпечний wrapper для database.write() з використанням DBLock.
 * Запобігає конкурентним записам, які викликають "Diagnostic error" у WatermelonDB.
 */
export async function safeWrite<T>(writeFn: () => Promise<T>): Promise<T> {
  const id = `safeWrite_${Date.now()}`;
  await DBLock.acquire(id);
  try {
    return await database.write(writeFn);
  } finally {
    DBLock.release();
  }
}
