import { schemaMigrations } from '@nozbe/watermelondb/Schema/migrations';

// Міграції для оновлення структури бази даних
export const dbMigrations = schemaMigrations({
  migrations: [
    // Міграція для додавання відсутніх колонок у версії 3
    {
      toVersion: 3,
      steps: [
        // Додаємо відсутні колонки для чат-повідомлень
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
    // Міграція для версії 4 - оновлення схеми для відповідності новій версії
    {
      toVersion: 4,
      steps: [
        // Порожня міграція, оскільки зміни вже включені в схему
      ]
    },
    // Міграція для версії 5 - зміна назви колонки assignments_count на assigned_count
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
    // Міграція для версії 6 - додавання поля priority до задач
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
    // Міграція для версії 7 - додавання таблиці task_assignments
    {
      toVersion: 7,
      steps: [
        {
          type: 'create_table',
          schema: {
            name: 'task_assignments',
            columns: [
              { name: 'task_id', type: 'string', isIndexed: true },
              { name: 'user_id', type: 'string', isIndexed: true },
              { name: 'status', type: 'string' },
              { name: 'fulfilled_role', type: 'string', isOptional: true },
              { name: 'assigned_at', type: 'number' },
              { name: 'is_synced', type: 'boolean' },
              { name: 'pending_action', type: 'string', isOptional: true },
              { name: 'last_synced_at', type: 'number', isOptional: true }
            ]
          }
        }
      ]
    },
    // Міграція для версії 8 - додавання колонки deadline до таблиці tasks
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
    // Міграція для версії 9 - додавання таблиці chats (вже в схемі, тому порожня)
    {
      toVersion: 9,
      steps: []
    },
    // Міграція для версії 10 - оновлення схеми (вже в схемі, тому порожня)
    {
      toVersion: 10,
      steps: []
    },
    // Міграція для версії 11 - додавання полів для offline attachments, user_name в assignments та таблиці task_reports
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
        },
        {
          type: 'sql',
          sql: 'CREATE TABLE IF NOT EXISTS task_reports (id TEXT PRIMARY KEY NOT NULL, server_id TEXT, task_id TEXT NOT NULL, user_id TEXT NOT NULL, user_name TEXT, comment TEXT NOT NULL, attachments_raw TEXT, created_at INTEGER NOT NULL, is_synced INTEGER NOT NULL, last_synced_at INTEGER);'
        }
      ]
    },
    // Міграція для версії 12 - гарантоване додавання server_id до task_reports
    {
      toVersion: 12,
      steps: [
        {
          type: 'sql',
          sql: 'ALTER TABLE task_reports ADD COLUMN IF NOT EXISTS server_id TEXT;'
        }
      ]
    }
  ]
});
