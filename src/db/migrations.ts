import { schemaMigrations } from '@nozbe/watermelondb/Schema/migrations';

// Міграції для оновлення структури бази даних
export const dbMigrations = schemaMigrations({
  migrations: [
    {
      toVersion: 3,
      steps: [
        {
          type: 'add_columns',
          table: 'chat_messages',
          columns: [
            { name: 'read_by_raw', type: 'string', isOptional: true },
            { name: 'delivered_to_raw', type: 'string', isOptional: true }
          ]
        }
      ]
    },
    {
      toVersion: 4,
      steps: []
    },
    {
      toVersion: 5,
      steps: [
        {
          type: 'add_columns',
          table: 'tasks',
          columns: [
            { name: 'assigned_count', type: 'number' }
          ]
        }
      ]
    },
    {
      toVersion: 6,
      steps: [
        {
          type: 'add_columns',
          table: 'tasks',
          columns: [
            { name: 'priority', type: 'number' }
          ]
        }
      ]
    },
    {
      toVersion: 7,
      steps: [
        {
          type: 'sql',
          sql: 'CREATE TABLE IF NOT EXISTS task_assignments (id TEXT PRIMARY KEY NOT NULL, task_id TEXT NOT NULL, user_id TEXT NOT NULL, status TEXT NOT NULL, fulfilled_role TEXT, assigned_at INTEGER NOT NULL, is_synced INTEGER NOT NULL, pending_action TEXT, last_synced_at INTEGER);'
        }
      ]
    },
    {
      toVersion: 8,
      steps: [
        {
          type: 'add_columns',
          table: 'tasks',
          columns: [
            { name: 'deadline', type: 'number', isOptional: true }
          ]
        }
      ]
    },
    {
      toVersion: 9,
      steps: []
    },
    {
      toVersion: 10,
      steps: []
    },
    {
      toVersion: 11,
      steps: [
        {
          type: 'add_columns',
          table: 'chat_messages',
          columns: [
            { name: 'message_type', type: 'string', isOptional: true },
            { name: 'attachment_url', type: 'string', isOptional: true },
          ]
        },
        {
          type: 'add_columns',
          table: 'task_assignments',
          columns: [
            { name: 'user_name', type: 'string', isOptional: true },
          ]
        }
      ]
    },
    {
      toVersion: 12,
      steps: []
    },
    {
      toVersion: 13,
      steps: [
        {
          type: 'add_columns',
          table: 'requests',
          columns: [{ name: 'last_synced_at', type: 'number', isOptional: true }],
        },
        {
          type: 'add_columns',
          table: 'tasks',
          columns: [{ name: 'last_synced_at', type: 'number', isOptional: true }],
        },
        {
          type: 'add_columns',
          table: 'chat_messages',
          columns: [{ name: 'last_synced_at', type: 'number', isOptional: true }],
        },
        {
          type: 'add_columns',
          table: 'chats',
          columns: [{ name: 'last_synced_at', type: 'number', isOptional: true }],
        },
        {
          type: 'add_columns',
          table: 'task_reports',
          columns: [{ name: 'last_synced_at', type: 'number', isOptional: true }],
        },
        {
          type: 'sql',
          sql: 'CREATE TABLE IF NOT EXISTS saved_requests (request_id TEXT NOT NULL, user_id TEXT NOT NULL, saved_at INTEGER NOT NULL); CREATE INDEX IF NOT EXISTS saved_requests_user_id ON saved_requests (user_id);'
        }
      ]
    },
    {
      toVersion: 14,
      steps: [
        {
          type: 'add_columns',
          table: 'chat_messages',
          columns: [{ name: 'reply_to_id', type: 'string', isOptional: true }],
        }
      ]
    }
  ]
});