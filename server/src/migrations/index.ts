import type { MigrationInterface } from 'typeorm';

/**
 * Every migration, in the order it must run. Appending is the only correct edit: the array
 * position is the order, and TypeORM records what it has applied by class name.
 */
export const migrations: (new () => MigrationInterface)[] = [];
