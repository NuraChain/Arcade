/**
 * What the route declarations are allowed to know about the rest of the server.
 *
 * This file, `./api.ts` and `./schemas.ts` are the CLIENT-SAFE triangle: the browser's
 * `application/src/api.ts` does `import type { Api } from '../../server/src/api.ts'` to get its
 * typed client, which pulls this whole import graph into the WEB typecheck program.
 *
 * That program is `application/tsconfig.json`, which has no `experimentalDecorators`. An entity
 * reached from here - even transitively, even as a type - would be parsed as an ES decorator
 * rather than a legacy one and fail `azeroth check` with an error pointing at the server.
 *
 * So handlers are injected rather than imported. Interfaces only below; every implementation
 * lives behind `buildPorts()` in `./services.ts`, which is server-only and free to touch
 * entities, the DataSource and anything else.
 */

export interface MetaPort
{
    info(): { wire: string; env: string };
}

/** Every port the API declaration may reach. One member per domain. */
export interface Ports
{
    meta: MetaPort;
}
