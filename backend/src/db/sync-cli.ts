import 'reflect-metadata';

import { dataSource } from '../data-source.ts';
import { syncSchema } from './schema.ts';

await dataSource.initialize();
await syncSchema(dataSource);
await dataSource.destroy();

process.stdout.write('schema synced\n');
