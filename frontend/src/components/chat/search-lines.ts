import type { Message } from '../../data/chat.ts';
import { plainOf } from '../../lib/markdown.ts';
import { fold } from '../../services/search.service.ts';

/**
 * What a line says as a search reads it: its words without their marks, folded as every search
 * here folds (case, Arabic and Persian letterforms, digits). A spoiler's words are left out, because
 * finding a line by them would give away what the spoiler hides.
 */
export const searchedWords = (message: Message) => fold(plainOf(message.text, ''));

/**
 * The lines of one room whose words hold what was typed, the newest first.
 *
 * Only lines this browser has opened can be searched: a sealed room has no index anywhere else. A
 * line it could not open says nothing to match, and a line is counted once however many of the
 * lists handed in hold it, the first holding it winning.
 */
export function searchLines(lines: Iterable<Message>, room: string, query: string, words: (message: Message) => string)
{
    const needle = fold(query);

    if (needle === '')
    {
        return [];
    }

    const seen = new Set<string>();
    const found: Message[] = [];

    for (const line of lines)
    {
        if (seen.has(line.id) || line.conversationId !== room || line.kind !== 'text' || line.locked !== undefined)
        {
            continue;
        }

        seen.add(line.id);

        if (words(line).includes(needle))
        {
            found.push(line);
        }
    }

    return found.sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : -1));
}
