import { object, string, type Infer } from '@azerothjs/schema';

/**
 * The wire shape, declared once.
 *
 * CLIENT-SAFE: this file may import `@azerothjs/schema` and nothing else. The browser's
 * `application/src/api.ts` re-exports the types below, so anything reachable from here lands in
 * the web typecheck program - which has no `experimentalDecorators` and would reject an entity.
 *
 * A new field starts here. The server validates against it on the way out and the browser's
 * type is inferred from the same declaration, so the two halves cannot disagree.
 */

export const serverInfo = object({
    /** The end-to-end wire version the client must speak. Bump it and old clients stop. */
    wire: string(),
    env: string()
});

export type ServerInfo = Infer<typeof serverInfo>;
