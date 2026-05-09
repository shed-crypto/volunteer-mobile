import { schemaMigrations } from '@nozbe/watermelondb/Schema/migrations';

// ── DEV NOTE: migrations reset ──────────────────────
// Since this app is still in development, old migrations have been
// cleaned up.  WatermelonDB will drop the existing DB and recreate
// it from the current schema on the next app start.
// ────────────────────────────────────────────────────

/**
 * Для оновлення схеми БД на пристроях де вже є дані:
 * 1. Збільшити dbSchema.version і додати нову міграцію в масив нижче
 * 2. Міграції повинні йти послідовно без пропусків!
 */
export const dbMigrations = schemaMigrations({
  migrations: [
    {
      toVersion: 2,
      steps: [
        { 
          type: 'add_columns', 
          table: 'requests', 
          columns: [
            { name: 'additional_info_raw', type: 'string', isOptional: true },
            { name: 'media_urls_raw', type: 'string', isOptional: true },
          ]
        }
      ]
    },
    {
      toVersion: 3,
      steps: [
        { 
          type: 'add_columns', 
          table: 'requests', 
          columns: [
            { name: 'report_urls_raw', type: 'string', isOptional: true },
          ]
        }
      ]
    }
  ]
});
