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
    }
  ]
});
