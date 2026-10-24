import 'reflect-metadata';

import { dataSource } from '../data-source.ts';
import { loadServerConfig } from '../env.ts';
import { syncSchema } from './schema.ts';

loadServerConfig();

await dataSource.initialize();
await syncSchema(dataSource);
await dataSource.destroy();

process.stdout.write('schema synced\n');
