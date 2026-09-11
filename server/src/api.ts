import { feature } from '@azerothjs/http/api';

import type { Ports } from './ports.ts';
import { serverInfo } from './schemas.ts';

/**
 * The whole API, declared once.
 *
 * Every route name is written exactly once: it keys this object, the manifest, the browser's
 * `client.<feature>.<route>`, and the OpenAPI operation.
 *
 * Handlers are taken from `ports` rather than imported, which is what keeps this file - and
 * therefore the browser's typed client - clear of the server's decorated entities. See
 * `./ports.ts` for why that matters.
 */
export function buildApi(ports: Ports)
{
    return {
        meta: feature('/meta', (routes) => ({
            /**
             * What the client needs before it can decide anything: the wire version it must
             * speak. Deliberately unguarded and deliberately tiny.
             */
            info: routes.get('/', { output: serverInfo }, () => ports.meta.info())
        }))
    };
}

/** The shape the browser builds its client from. Types only - erased at build. */
export type Api = ReturnType<typeof buildApi>;
