import type { GameId } from '../data/games.ts';

/** A pack of recordings, and the cues each one holds: every cue is in exactly one. */
export const CUES = {
    common: ['turn', 'tick', 'tick-hi', 'deny', 'pass', 'chime', 'win', 'lose', 'draw', 'hand-won'],
    cards: ['card-slide', 'card-place', 'card-gather', 'card-shuffle', 'card-fan'],
    hokm: ['trump', 'trick'],
    ludo: ['die-shake', 'die-land', 'pawn-step', 'pawn-hit', 'pawn-yard', 'six', 'home'],
    backgammon: ['cup-shake', 'dice-wood', 'checker', 'checker-hit', 'checker-bar', 'checker-off', 'cube'],
    poker: ['chip-lay', 'chips-stack', 'chips-gather', 'knock'],
    chess: ['piece-move', 'piece-capture', 'check', 'promote', 'horse-step', 'horse-call', 'elephant-step', 'elephant-call', 'king-fall']
} as const;

export type Pack = keyof typeof CUES;

export type Sampled = (typeof CUES)[Pack][number];

export const SAMPLED: readonly Sampled[] = Object.values(CUES).flat();

/** The packs a table of each game plays from; anything that is not a table plays from `common` alone. */
export const TABLE_PACKS: Record<GameId, readonly Pack[]> = {
    ludo: ['common', 'ludo'],
    hokm: ['common', 'cards', 'hokm'],
    poker: ['common', 'cards', 'poker'],
    backgammon: ['common', 'backgammon'],
    chess: ['common', 'chess']
};

export const PACKS: Record<Pack, string> = {
    common: new URL('./sound/common.cues', import.meta.url).href,
    cards: new URL('./sound/cards.cues', import.meta.url).href,
    hokm: new URL('./sound/hokm.cues', import.meta.url).href,
    ludo: new URL('./sound/ludo.cues', import.meta.url).href,
    backgammon: new URL('./sound/backgammon.cues', import.meta.url).href,
    poker: new URL('./sound/poker.cues', import.meta.url).href,
    chess: new URL('./sound/chess.cues', import.meta.url).href
};

const MAGIC = 'NCUE';

export function unpack(bytes: ArrayBuffer, cues: readonly Sampled[])
{
    const found = new Map<Sampled, ArrayBuffer[]>();

    if (bytes.byteLength < 8 || new TextDecoder().decode(bytes.slice(0, 4)) !== MAGIC)
    {
        return found;
    }

    const length = new DataView(bytes).getUint32(4, true);
    const start = 8 + length;
    const index = JSON.parse(new TextDecoder().decode(bytes.slice(8, start))) as Record<string, [number, number][]>;

    for (const cue of cues)
    {
        const takes = (index[cue] ?? [])
            .filter(([offset, size]) => offset >= 0 && size > 0 && start + offset + size <= bytes.byteLength)
            .map(([offset, size]) => bytes.slice(start + offset, start + offset + size));

        if (takes.length > 0)
        {
            found.set(cue, takes);
        }
    }

    return found;
}
