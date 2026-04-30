/**
 * src/db/schema.ts — WatermelonDB схема бази даних
 */
import { appSchema, tableSchema } from '@nozbe/watermelondb';

export const dbSchema = appSchema({
  version: 14,
  tables: [
    // ─── Заявки ─────────────────────────────────────────────────────────────
    tableSchema({
      name: 'requests',
      columns: [
        { name: 'server_id', type: 'string', isIndexed: true },
        { name: 'title', type: 'string' },
        { name: 'description', type: 'string', isOptional: true },
        { name: 'category', type: 'string' },
        { name: 'urgency', type: 'string' },
        { name: 'status', type: 'string', isIndexed: true },
        { name: 'required_clearance', type: 'string' },
        { name: 'creator_id', type: 'string', isOptional: true },
        { name: 'creator_name', type: 'string', isOptional: true },
        { name: 'latitude', type: 'number', isOptional: true },
        { name: 'longitude', type: 'number', isOptional: true },
        { name: 'is_location_hidden', type: 'boolean' },
        { name: 'tags', type: 'string', isOptional: true }, // JSON array
        { name: 'deadline', type: 'number', isOptional: true },
        { name: 'created_at_server', type: 'number', isOptional: true },
        { name: 'is_synced', type: 'boolean' },
        { name: 'pending_action', type: 'string', isOptional: true },
        { name: 'last_synced_at', type: 'number', isOptional: true }, // Додано для відстеження останньої синхронізації
      ],
    }),

    // ─── Задачі / підзадачі ──────────────────────────────────────────────────
    tableSchema({
      name: 'tasks',
      columns: [
        { name: 'server_id', type: 'string', isIndexed: true },
        { name: 'request_id', type: 'string', isIndexed: true },
        { name: 'request_server_id', type: 'string', isOptional: true },
        { name: 'title', type: 'string' },
        { name: 'description', type: 'string', isOptional: true },
        { name: 'status', type: 'string' },
        { name: 'needed_people_count', type: 'number' },
        { name: 'required_roles', type: 'string', isOptional: true }, // JSON array
        { name: 'assigned_count', type: 'number' },
        { name: 'priority', type: 'number' },
        { name: 'chat_id', type: 'string', isOptional: true },
        { name: 'deadline', type: 'number', isOptional: true }, // Виправлення: додано колонку deadline
        { name: 'created_at_server', type: 'number', isOptional: true },
        { name: 'is_synced', type: 'boolean' },
        { name: 'pending_action', type: 'string', isOptional: true },
        { name: 'last_synced_at', type: 'number', isOptional: true }, // Додано для відстеження останньої синхронізації
      ],
    }),

    // ─── Призначення задач ──────────────────────────────────────────────────
    tableSchema({
      name: 'task_assignments',
      columns: [
        { name: 'task_id', type: 'string', isIndexed: true },
        { name: 'user_id', type: 'string', isIndexed: true },
        { name: 'user_name', type: 'string', isOptional: true },
        { name: 'status', type: 'string' },
        { name: 'fulfilled_role', type: 'string', isOptional: true },
        { name: 'assigned_at', type: 'number' },
        { name: 'is_synced', type: 'boolean' },
        { name: 'pending_action', type: 'string', isOptional: true },
        { name: 'last_synced_at', type: 'number', isOptional: true },
      ],
    }),

    // ─── Повідомлення чатів ──────────────────────────────────────────────────
    tableSchema({
      name: 'chat_messages',
      columns: [
        { name: 'server_id', type: 'string', isOptional: true },
        { name: 'chat_id', type: 'string', isIndexed: true },
        { name: 'sender_id', type: 'string' },
        { name: 'sender_name', type: 'string', isOptional: true },
        { name: 'content', type: 'string' },
        { name: 'sent_at', type: 'number' },
        { name: 'is_synced', type: 'boolean' },
        { name: 'pending_action', type: 'string', isOptional: true },
        { name: 'message_type', type: 'string', isOptional: true }, // 'text' | 'attachment' | 'system'
        { name: 'attachment_url', type: 'string', isOptional: true },
        { name: 'message_status', type: 'string', isOptional: true }, // 'sent' | 'delivered' | 'read' | 'pending' | 'failed'
        { name: 'read_by_raw', type: 'string', isOptional: true }, // JSON array of user IDs who read the message
        { name: 'delivered_to_raw', type: 'string', isOptional: true }, // JSON array of user IDs message was delivered to
        { name: 'reply_to_id', type: 'string', isOptional: true },
        { name: 'last_synced_at', type: 'number', isOptional: true },
      ],
    }),

    // ─── Кеш профілів користувачів ───────────────────────────────────────────
    tableSchema({
      name: 'users_cache',
      columns: [
        { name: 'server_id', type: 'string', isIndexed: true },
        { name: 'full_name', type: 'string' },
        { name: 'email', type: 'string', isOptional: true },
        { name: 'system_role', type: 'string' },
        { name: 'clearance_level', type: 'string' },
        { name: 'trust_score', type: 'number' },
        { name: 'is_blocked', type: 'boolean' },
        { name: 'cached_at', type: 'number' },
      ],
    }),

    // ─── Чернетки звітів ─────────────────────────────────────────────────────
    tableSchema({
      name: 'pending_reports',
      columns: [
        { name: 'task_id', type: 'string', isIndexed: true },
        { name: 'text', type: 'string', isOptional: true },
        { name: 'photo_uris', type: 'string', isOptional: true }, // JSON array
        { name: 'created_at', type: 'number' },
        { name: 'is_sent', type: 'boolean' },
      ],
    }),

    // ─── Чати (кеш для списку чатів) ─────────────────────────────────────────
    tableSchema({
      name: 'chats',
      columns: [
        { name: 'server_id', type: 'string', isIndexed: true },
        { name: 'name', type: 'string', isOptional: true },
        { name: 'type', type: 'string' },
        { name: 'participants_raw', type: 'string', isOptional: true }, // JSON array
        { name: 'last_message_raw', type: 'string', isOptional: true }, // JSON object
        { name: 'unread_count', type: 'number' },
        { name: 'updated_at', type: 'number' },
        { name: 'is_synced', type: 'boolean' },
        { name: 'last_synced_at', type: 'number', isOptional: true },
      ],
    }),

    // ─── Збережені заявки ─────────────────────────────────────────────────────
    tableSchema({
      name: 'saved_requests',
      columns: [
        { name: 'request_id', type: 'string', isIndexed: true },
        { name: 'user_id', type: 'string', isIndexed: true },
        { name: 'saved_at', type: 'number' },
      ],
    }),

    // ─── Звіти по задачах ────────────────────────────────────────────────────
    tableSchema({
      name: 'task_reports',
      columns: [
        { name: 'server_id', type: 'string', isOptional: true },
        { name: 'task_id', type: 'string', isIndexed: true },
        { name: 'user_id', type: 'string' },
        { name: 'user_name', type: 'string', isOptional: true },
        { name: 'comment', type: 'string' },
        { name: 'attachments_raw', type: 'string', isOptional: true }, // JSON array
        { name: 'created_at', type: 'number' },
        { name: 'is_synced', type: 'boolean' },
        { name: 'last_synced_at', type: 'number', isOptional: true },
      ],
    }),

    // ─── Черга офлайн-дій ────────────────────────────────────────────────────
    tableSchema({
      name: 'action_queue',
      columns: [
        { name: 'action_type', type: 'string' },
        { name: 'payload', type: 'string' },
        { name: 'created_at', type: 'number' },
        { name: 'retry_count', type: 'number' },
        { name: 'error', type: 'string', isOptional: true },
      ],
    }),
  ],
});
