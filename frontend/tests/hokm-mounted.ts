import { renderTest } from '@azerothjs/testing';
import { batch, createSignal } from 'azerothjs';

import HokmBoard from '../src/components/games/hokm-board.component.azeroth';
import { feltOf, step } from '../src/game/hokm-felt.ts';
import type { ManualClock } from '../src/lib/clock.ts';
import { runtime } from '../src/lib/runtime.ts';
import { NO_EVENTS, type EventBatch, type MatchEvent } from '../src/stores/match.store.ts';
import type { MatchView } from '../src/api.ts';

export type Hokm = Extract<MatchView['view'], { kind: 'hokm' }>;

export type Move = Extract<MatchEvent['log'], { kind: 'hokm' }>['moves'][number];

export const act = (rev: number, seat: number, ...moves: Move[]): MatchEvent => ({ rev, seat, at: '', log: { kind: 'hokm', moves } });

export const card = (rev: number, seat: number, at: number) => act(rev, seat, { e: 'card', seat, card: at });

export const flush = async () =>
{
    for (let turn = 0; turn < 12; turn += 1)
    {
        await Promise.resolve();
    }
};

export const elapse = async (ms: number, by = 1) =>
{
    const clock = runtime().clock as ManualClock;

    await flush();

    for (let left = ms; left > 0; left -= by)
    {
        clock.advance(Math.min(by, left));
        await flush();
    }

    await flush();
};

export function after(match: MatchView, events: readonly MatchEvent[], view: Partial<Hokm> = {}, more: Partial<MatchView> = {}): MatchView
{
    const held = match.view as Hokm;
    const moves = events.flatMap((event) => (event.log.kind === 'hokm' ? event.log.moves : []));
    const felt = moves.reduce(step, feltOf(held, match.seats));
    const played = moves.flatMap((move) => (move.e === 'card' && move.seat === match.mine && move.card !== undefined ? [move.card] : []));

    return {
        ...match,
        ...more,
        rev: events[events.length - 1]?.rev ?? match.rev,
        view: {
            ...held,
            phase: felt.phase,
            hakem: felt.hakem,
            dealer: felt.dealer,
            trump: (felt.trump ?? undefined) as Hokm['trump'],
            round: felt.round,
            lead: felt.lead,
            turn: felt.turn,
            trick: felt.cards.map((one) => one.card),
            took: felt.took === null ? undefined : { lead: held.lead, cards: [...felt.took.cards], seat: felt.took.seat },
            seats: felt.chairs.map((chair) => ({ ...chair })),
            points: [...felt.points],
            stock: felt.stock ?? undefined,
            hand: held.hand.filter((one) => !played.includes(one)),
            plays: [],
            ...view
        }
    };
}

export async function mounted(first: MatchView, heard: EventBatch = NO_EVENTS, watch?: (busy: boolean) => void)
{
    const [current, setCurrent] = createSignal(first);
    const [told, setTold] = createSignal<EventBatch>({ ...heard });
    const { container } = renderTest(() => HokmBoard({
        get match()
        {
            return current();
        },
        get events()
        {
            return told();
        },
        onPresenting: watch
    }) as HTMLElement);

    await flush();

    return {
        container,
        match: current,
        read: (next: MatchView) => setCurrent(structuredClone(next)),
        send: (events: MatchEvent[], view: Partial<Hokm> = {}, more: Partial<MatchView> = {}) => batch(() =>
        {
            const next = after(current(), events, view, more);

            setCurrent(next);
            setTold((last) => ({ ...NO_EVENTS, seq: last.seq + 1, id: next.id, events }));
        })
    };
}
