import type { MigrationInterface } from 'typeorm';

import { ReferenceCatalogue1789138458214 } from './0001-reference.ts';

/**
 * Every migration. Appending is the only correct edit.
 *
 * The ORDER comes from the timestamp each class name ends with, not from this array — TypeORM
 * sorts by it and refuses a class without one. The array is registration, and it is explicit
 * rather than a glob so a renamed migration fails `azeroth check` instead of silently vanishing
 * from the run.
 */
export const migrations: (new () => MigrationInterface)[] = [
    ReferenceCatalogue1789138458214
];
