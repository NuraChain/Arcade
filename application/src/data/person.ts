/**
 * The person the browser renders.
 *
 * It IS the server's `PersonSummary` - aliased rather than redeclared, so there is no second
 * definition to drift. The version this replaces was a fixture interface with a level, a skill
 * band, a favourite game and a per-game record, none of which anything produced.
 *
 * Kept as a named alias because `Person` is what twenty-six files call the thing they are drawing,
 * and `PersonSummary` is what the wire calls the shape it sends. Same object, two vocabularies.
 */
export type { PersonSummary as Person } from '../api.ts';
