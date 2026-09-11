import type { DataSource } from 'typeorm';

import { createCatalogueService } from './domains/catalogue/service.ts';
import type { Ports } from './ports.ts';

/**
 * Builds the real implementations behind `Ports`.
 *
 * SERVER-ONLY. This is the first file in the chain that may touch the DataSource and the
 * entities, and nothing the browser imports may ever reach it.
 */
export function buildPorts(db: DataSource): Ports
{
    return {
        meta: {
            info: () => ({ wire: 'nura-e2ee/v1', env: process.env.NODE_ENV ?? 'development' })
        },
        catalogue: createCatalogueService(db)
    };
}
