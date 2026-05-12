/**
 * src/db/migrations.ts — WatermelonDB міграції
 */
import { schemaMigrations } from '@nozbe/watermelondb/Schema/migrations';

export const dbMigrations = schemaMigrations({
  migrations: [
    // toVersion: 1 — це початкова схема, міграції починаються з 2
    {
      toVersion: 2,
      steps: []
    },
    {
      toVersion: 3,
      steps: []
    },
    {
      toVersion: 4,
      steps: []
    },
    {
      toVersion: 5,
      steps: []
    },
  ],
});
