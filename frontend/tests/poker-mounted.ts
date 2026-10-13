import { vi } from 'vitest';
import { renderTest } from '@azerothjs/testing';
import { createSignal } from 'azerothjs';

import PokerBoard from '../src/components/games/poker-board.component.azeroth';
import type { ManualClock } from '../src/lib/clock.ts';
import { runtime } from '../src/lib/runtime.ts';
import { NO_EVENTS, type EventBatch, type MatchEvent } from '../src/stores/match.store.ts';
import type { MatchView } from '../src/api.ts';

export type Poker = Extract<MatchView['view'], { kind: 'poker' }>;

export type Move = Extract<MatchEvent['log'], { kind: 'poker' }>['moves'][number];

const HANDLES = ['dana.w', 'omid.k', 'sara.k', 'reza.t', 'mina', 'leila.a'];

export const EVERYBODY = [0, 1, 2, 3, 4, 5];

export const BLINDS = { 3: { stack: 1490, bet: 10 }, 4: { stack: 1480, bet: 20 } };

export const rows = (changed: Record<number, Partial<Poker['seats'][number]>> = {}) =>
    Array.from({ length: 6 }, (_, seat) => ({ seat, stack: 1500, bet: 0, folded: false, allIn: false, out: false, ...changed[seat] }));

export const match = (view: Partial<Poker> = {}, more: Partial<MatchView> = {}): MatchView => ({
    id: 'match-pk',
    tableId: 'table-pk',
    game: 'poker',
    rev: 7,
    seats: 6,
    players: Array.from({ length: 6 }, (_, seat) => ({ seat, who: HANDLES[seat], timeouts: 0 })) as MatchView['players'],
    turn: 1,
    mine: 0,
    startedAt: new Date(400_000).toISOString(),
    view: {
        kind: 'poker',
        street: 'preflop',
        hand: 1,
        button: 2,
        turn: 1,
        board: [],
        pot: 30,
        pots: [{ amount: 30, eligible: EVERYBODY }],
        seats: rows(BLINDS),
        blinds: { small: 10, big: 20, level: 1, next: 10 },
        hole: [0, 13],
        ...view
    },
    ...more
});

export const told = (rev: number, seat: number, ...moves: Move[]): MatchEvent => ({ rev, seat, at: '', log: { kind: 'poker', moves } });

export const heard = (seq: number, ...events: MatchEvent[]): EventBatch => ({ seq, id: 'match-pk', events, live: true, jump: false });

export const turns = async () =>
{
    for (let turn = 0; turn < 8; turn += 1)
    {
        await Promise.resolve();
    }
};

export const elapse = async (ms: number, step = 10) =>
{
    const clock = runtime().clock as ManualClock;

    for (let spent = 0; spent < ms; spent += step)
    {
        clock.advance(Math.min(step, ms - spent));
        await turns();
    }
};

const at = (x: number, y: number, width: number, height: number) => ({ x, y, left: x, top: y, right: x + width, bottom: y + height, width, height, toJSON: () => ({}) }) as DOMRect;

export const places = () => vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element)
{
    const seat = Number(this.closest('.poker-seat')?.getAttribute('data-seat') ?? -1);

    if (this.classList.contains('board-flight') || this.classList.contains('poker-stage') || this.classList.contains('poker-table'))
    {
        return at(0, 0, 400, 800);
    }

    if (this.classList.contains('table-plate'))
    {
        return at(20 + seat * 60, 700 - seat * 100, 120, 40);
    }

    if (this.classList.contains('chip-stack') && this.closest('.poker-pot') !== null)
    {
        return at(190, 400, 10, 10);
    }

    if (this.classList.contains('chip-stack') && seat >= 0)
    {
        return at(40 + seat * 60, 640 - seat * 100, 10, 10);
    }

    return at(0, 0, 0, 0);
});

export const seated = async (first: MatchView, events: EventBatch = NO_EVENTS) =>
{
    const [current, setCurrent] = createSignal({ match: first, events });
    const busy: boolean[] = [];
    const { container } = renderTest(() => PokerBoard({
        get match()
        {
            return current().match;
        },
        get events()
        {
            return current().events;
        },
        onPresenting: (now: boolean) =>
        {
            busy.push(now);
        },
        turnMs: 30_000
    }) as HTMLElement);

    await turns();

    const write = (next: MatchView, batch: EventBatch = current().events) => setCurrent({ match: structuredClone(next), events: batch });

    return {
        container,
        busy,
        write,
        read: async (next: MatchView, batch?: EventBatch) =>
        {
            write(next, batch);
            await turns();
        }
    };
};

export const bet = (container: HTMLElement, seat: number) =>
{
    const pill = container.querySelector<HTMLElement>(`.poker-seat[data-seat="${ seat }"] .poker-bet`);

    return pill === null ? '' : `${ pill.textContent ?? '' }${ pill.dataset.landing === 'true' ? ' (landing)' : '' }`;
};

export const stack = (container: HTMLElement, seat: number) => container.querySelector(`.poker-seat[data-seat="${ seat }"] .table-plate-facts .tally`)?.textContent ?? '';

export const pot = (container: HTMLElement) => container.querySelector('.poker-pot')?.textContent?.trim() ?? '';

export const flights = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>('.board-flight > .flight')];

export const presenting = (container: HTMLElement) => container.querySelector('.poker-stage')?.getAttribute('data-presenting') ?? null;
