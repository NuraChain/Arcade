import type { IconName } from '../icons/registry.ts';

/**
 * The crests a group may wear.
 *
 * A closed set, and the client decides it: the crest arrives from the server as a plain string,
 * and `Icon` takes an `IconName`. Without this, a row written by a newer server - or by hand -
 * would be rendered by looking its value up in the registry and finding nothing, which is a blank
 * square where a group's identity should be.
 *
 * Groups are named with a shape, never with an emoji: see the glyph rule in CLAUDE.md.
 */
export const CRESTS: IconName[] = ['crest-crown', 'crest-cup', 'crest-castle', 'crest-moon', 'crest-sprout'];

/** The crest this value names, or the first one - a group always has a face. */
export function crestOf(value: string): IconName
{
    return (CRESTS as string[]).includes(value) ? value as IconName : CRESTS[0];
}
