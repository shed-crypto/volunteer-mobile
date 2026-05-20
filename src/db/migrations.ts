/**
 * src/db/migrations.ts — WatermelonDB міграції
 *
 * v2 — додано action_queue
 * v3 — різні зміни
 * v4 — різні зміни
 * v5 — додано sync_events таблицю
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
  ],
});
