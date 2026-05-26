/**
 * src/db/migrations.ts — WatermelonDB міграції
 *
 * v2 — додано action_queue
 * v3 — різні зміни
 * v4 — різні зміни
 * v5 — додано sync_events таблицю
 * v9 — додано organizations, organization_members, organization_hubs, organization_join_requests
 */
import { schemaMigrations, createTable, addColumns } from '@nozbe/watermelondb/Schema/migrations';

export const dbMigrations = schemaMigrations({
  migrations: [
    {
      toVersion: 2,
      steps: [],
    },
    {
      toVersion: 3,
      steps: [],
    },
    {
      toVersion: 4,
      steps: [],
    },
    {
      toVersion: 5,
      steps: [
        createTable({
          name: 'sync_events',
          columns: [
            { name: 'event_type', type: 'string', isIndexed: true },
            { name: 'title', type: 'string' },
            { name: 'description', type: 'string', isOptional: true },
            { name: 'is_error', type: 'boolean' },
            { name: 'is_read', type: 'boolean' },
            { name: 'created_at', type: 'number', isIndexed: true },
            { name: 'metadata_raw', type: 'string', isOptional: true },
          ],
        }),
      ],
    },
    {
      toVersion: 6,
      steps: [
        addColumns({
          table: 'requests',
          columns: [
            { name: 'managing_organization_id', type: 'string', isOptional: true },
          ],
        }),
        addColumns({
          table: 'tasks',
          columns: [
            { name: 'created_by_user_id', type: 'string', isOptional: true },
            { name: 'origin', type: 'string', isOptional: true },
            { name: 'is_auto_generated', type: 'boolean', isOptional: true },
          ],
        }),
      ],
    },
    {
      toVersion: 7,
      steps: [
        addColumns({
          table: 'requests',
          columns: [
            { name: 'cancelled_by_user_id', type: 'string', isOptional: true },
            { name: 'cancelled_at', type: 'number', isOptional: true },
            { name: 'cancel_reason', type: 'string', isOptional: true },
          ],
        }),
      ],
    },
    {
      toVersion: 8,
      steps: [
        addColumns({
          table: 'requests',
          columns: [
            { name: 'task_count', type: 'number', isOptional: true },
          ],
        }),
      ],
    },
    {
      toVersion: 9,
      steps: [
        createTable({
          name: 'organizations',
          columns: [
            { name: 'server_id', type: 'string', isIndexed: true },
            { name: 'name', type: 'string' },
            { name: 'description', type: 'string', isOptional: true },
            { name: 'logo_url', type: 'string', isOptional: true },
            { name: 'parent_org_id', type: 'string', isOptional: true },
            { name: 'is_public', type: 'boolean' },
            { name: 'tags_raw', type: 'string', isOptional: true },
            { name: 'is_synced', type: 'boolean' },
            { name: 'last_synced_at', type: 'number', isOptional: true },
          ],
        }),
        createTable({
          name: 'organization_members',
          columns: [
            { name: 'server_id', type: 'string', isIndexed: true },
            { name: 'organization_id', type: 'string', isIndexed: true },
            { name: 'user_id', type: 'string', isIndexed: true },
            { name: 'user_name', type: 'string', isOptional: true },
            { name: 'org_role', type: 'string' },
            { name: 'is_deputy', type: 'boolean' },
            { name: 'is_active', type: 'boolean' },
            { name: 'joined_at', type: 'number' },
            { name: 'is_synced', type: 'boolean' },
            { name: 'last_synced_at', type: 'number', isOptional: true },
          ],
        }),
        createTable({
          name: 'organization_hubs',
          columns: [
            { name: 'server_id', type: 'string', isIndexed: true },
            { name: 'organization_id', type: 'string', isIndexed: true },
            { name: 'name', type: 'string' },
            { name: 'description', type: 'string', isOptional: true },
            { name: 'address', type: 'string', isOptional: true },
            { name: 'latitude', type: 'number', isOptional: true },
            { name: 'longitude', type: 'number', isOptional: true },
            { name: 'media_url', type: 'string', isOptional: true },
            { name: 'is_public', type: 'boolean' },
            { name: 'is_synced', type: 'boolean' },
            { name: 'last_synced_at', type: 'number', isOptional: true },
          ],
        }),
        createTable({
          name: 'organization_join_requests',
          columns: [
            { name: 'server_id', type: 'string', isIndexed: true },
            { name: 'organization_id', type: 'string', isIndexed: true },
            { name: 'user_id', type: 'string' },
            { name: 'user_name', type: 'string', isOptional: true },
            { name: 'message', type: 'string', isOptional: true },
            { name: 'status', type: 'string' },
            { name: 'reviewed_by', type: 'string', isOptional: true },
            { name: 'review_comment', type: 'string', isOptional: true },
            { name: 'reviewed_at', type: 'number', isOptional: true },
            { name: 'is_synced', type: 'boolean' },
            { name: 'last_synced_at', type: 'number', isOptional: true },
          ],
        }),
      ],
    },
  ],
});