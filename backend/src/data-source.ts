import 'reflect-metadata';

import { DataSource } from 'typeorm';

import { entities } from './entities/index.ts';
import { oneAtATime } from './lib/one-at-a-time.ts';

// The TypeORM CLI never goes through main.ts, so it loads the environment itself. A missing
// .env is not an error here: the ambient environment is a valid way to configure a deployment.
try
{
    process.loadEnvFile();
}
catch
{
    // No .env file - the ambient environment is the configuration.
}

/**
 * The single DataSource export. `CommandUtils.loadDataSource` errors on zero or two, and the
 * migration scripts point at `dist/data-source.js` - the COMPILED file, because Node cannot
 * execute a decorated source file at all.
 *
 * Entities and migrations are explicit arrays, never globs. TypeORM resolves a glob against
 * `process.cwd()` rather than against this file, so a glob silently yields nothing from any
 * other working directory, and a stale `.js` left in dist by a deleted entity gets resurrected.
 * An explicit import also makes `azeroth check` fail loudly when an entity is renamed.
 */
export const dataSource = new DataSource({
    type: 'postgres',
    url: process.env.DATABASE_URL,
    uuidExtension: 'pgcrypto',
    entities,

    synchronize: false,

    extra: {
        max: Math.max(1, Number.parseInt(process.env.DATABASE_POOL_MAX ?? '10', 10) || 10),
        connectionTimeoutMillis: 5000,
        idleTimeoutMillis: 30_000,
        statement_timeout: 30_000
    },

    logging: process.env.NODE_ENV === 'development' ? ['error', 'warn', 'migration'] : ['error']
});

const createRunner = dataSource.driver.createQueryRunner.bind(dataSource.driver);

dataSource.driver.createQueryRunner = (mode) => oneAtATime(createRunner(mode));
