import { TIMING } from './motion.ts';

export interface HokmMove
{
    e: 'trump' | 'card' | 'trick' | 'hand' | 'deal' | 'forfeit' | 'finish';
    seat?: number;
    suit?: string;
    card?: number;
    side?: number;
    points?: number;
    kot?: boolean;
    hakem?: number;
}

export interface Laid
{
    card: number;
    seat: number;
}

export interface Felt
{
    cards: readonly Laid[];
    took: number | null;
}

export interface Reader
{
    seat: number | null;
    seats: number;
    sideOf: (seat: number) => number;
}

export type Beat =
    | { at: number; kind: 'card'; card: number; seat: number; duration: number }
    | { at: number; kind: 'land'; card: number; seat: number }
    | { at: number; kind: 'took'; seat: number; ours: boolean }
    | { at: number; kind: 'gather'; seat: number; cards: readonly Laid[] }
    | { at: number; kind: 'clear' }
    | { at: number; kind: 'trump'; suit: string; ours: boolean }
    | { at: number; kind: 'deal'; from: number; to: readonly number[]; gap: number; duration: number; shuffle: boolean }
    | { at: number; kind: 'hand'; side: number; points: number; kot: boolean; ours: boolean }
    | { at: number; kind: 'finish'; won: boolean };

export interface Timeline
{
    beats: Beat[];
    felt: Felt;
    ends: number;
    held: number | null;
}

export const EMPTY: Felt = { cards: [], took: null };

export const CATCH_UP_ACTIONS = 12;

export const gatherOrder = (cards: readonly Laid[], took: number): Laid[] =>
    [...cards.filter((one) => one.seat !== took), ...cards.filter((one) => one.seat === took)];

export const gatherLength = (count: number): number => TIMING.GATHER + TIMING.GATHER_GAP * Math.max(0, count - 1);

export const overflows = (actions: number, moves: readonly HokmMove[]): boolean =>
    actions > CATCH_UP_ACTIONS || moves.filter((move) => move.e === 'hand').length > 1;

const dealerOf = (hakem: number, seats: number): number => (hakem - 1 + seats) % seats;

function dealing(from: number, to: readonly number[], at: number, shuffle: boolean): { beat: Beat; ends: number }
{
    const lead = shuffle ? 450 : 0;
    const gap = to.length <= 1 ? 0 : Math.min(TIMING.DEAL_GAP_MAX, (TIMING.DEAL_TOTAL_MAX - TIMING.DEAL_FLY) / (to.length - 1));

    return {
        beat: { at, kind: 'deal', from, to, gap, duration: TIMING.DEAL_FLY, shuffle },
        ends: at + lead + gap * Math.max(0, to.length - 1) + TIMING.DEAL_FLY
    };
}

export function beatsOf(moves: readonly HokmMove[], felt: Felt, reader: Reader, heldFor = 0): Timeline
{
    const beats: Beat[] = [];
    const ours = (seat: number): boolean => reader.seat !== null && reader.sideOf(seat) === reader.sideOf(reader.seat);
    let cards: Laid[] = [...felt.cards];
    let took = felt.took;
    let at = 0;
    let settled = 0;
    let tookAt = took === null ? null : -heldFor;

    const gather = (hold: number): void =>
    {
        if (took === null)
        {
            return;
        }

        const start = Math.max(at, (tookAt ?? at) + hold);
        const order = gatherOrder(cards, took);

        beats.push({ at: start, kind: 'gather', seat: took, cards: order });

        const done = start + gatherLength(order.length);

        beats.push({ at: done, kind: 'clear' });
        cards = [];
        took = null;
        tookAt = null;
        at = done;
        settled = done;
    };

    moves.forEach((move) =>
    {
        if (move.e === 'card' && move.card !== undefined && move.seat !== undefined)
        {
            gather(TIMING.HOLD_MIN);

            const duration = move.seat === reader.seat ? TIMING.FLY : TIMING.FLY_THEIRS;

            beats.push({ at, kind: 'card', card: move.card, seat: move.seat, duration });
            beats.push({ at: at + duration, kind: 'land', card: move.card, seat: move.seat });
            cards = [...cards, { card: move.card, seat: move.seat }];
            settled = Math.max(settled, at + duration);
            at += TIMING.SEQ_GAP;
            return;
        }

        if (move.e === 'trick' && move.seat !== undefined)
        {
            const when = Math.max(at, settled) + TIMING.SETTLE;

            beats.push({ at: when, kind: 'took', seat: move.seat, ours: ours(move.seat) });
            took = move.seat;
            tookAt = when;
            at = when;
            settled = when;
            return;
        }

        if (move.e === 'hand' && move.side !== undefined)
        {
            gather(TIMING.HOLD);
            at = Math.max(at, settled);

            const mineSide = reader.seat !== null && reader.sideOf(reader.seat) === move.side;

            beats.push({ at, kind: 'hand', side: move.side, points: move.points ?? 0, kot: move.kot === true, ours: mineSide });
            at += TIMING.BANNER;
            settled = at;
            return;
        }

        if (move.e === 'deal' && move.hakem !== undefined)
        {
            gather(TIMING.HOLD_MIN);
            at = Math.max(at, settled);

            const dealt = dealing(dealerOf(move.hakem, reader.seats), [move.hakem], at, true);

            beats.push(dealt.beat);
            at = dealt.ends;
            settled = at;
            return;
        }

        if (move.e === 'trump' && move.suit !== undefined)
        {
            at = Math.max(at, settled);

            const hakem = move.seat ?? 0;

            beats.push({ at, kind: 'trump', suit: move.suit, ours: move.seat !== undefined && move.seat === reader.seat });

            const order = Array.from({ length: reader.seats }, (_, step) => (dealerOf(hakem, reader.seats) + 1 + step) % reader.seats);
            const dealt = dealing(dealerOf(hakem, reader.seats), order, at + TIMING.FADE, false);

            beats.push(dealt.beat);
            at = dealt.ends;
            settled = at;
            return;
        }

        if (move.e === 'finish')
        {
            gather(TIMING.HOLD);
            at = Math.max(at, settled);
            beats.push({ at, kind: 'finish', won: move.side !== undefined && reader.seat !== null && reader.sideOf(reader.seat) === move.side });
        }
    });

    return { beats, felt: { cards, took }, ends: Math.max(at, settled), held: took === null ? null : tookAt };
}

export function feltOf(trick: readonly number[], lead: number, seats: number): Felt
{
    return { cards: trick.map((card, offset) => ({ card, seat: (lead + offset) % seats })), took: null };
}

export function scaled(timeline: Timeline, factor: number): Timeline
{
    const quick = (beat: Beat): Beat =>
    {
        if (beat.kind === 'card')
        {
            return { ...beat, at: beat.at * factor, duration: beat.duration * factor };
        }

        if (beat.kind === 'deal')
        {
            return { ...beat, at: beat.at * factor, gap: beat.gap * factor, duration: beat.duration * factor };
        }

        return { ...beat, at: beat.at * factor };
    };

    return {
        beats: timeline.beats.map(quick),
        felt: timeline.felt,
        ends: timeline.ends * factor,
        held: timeline.held === null ? null : timeline.held * factor
    };
}
