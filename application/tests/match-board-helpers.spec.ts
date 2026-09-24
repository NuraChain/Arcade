import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, renderTest } from '@azerothjs/testing';
import { createSignal } from 'azerothjs';

import MatchBoard from '../src/components/games/match-board.component.azeroth';
import { manualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import '../src/locales/app-catalogue.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useBoard, type EventBatch } from '../src/stores/match.store.ts';
import { usePeople } from '../src/stores/people.store.ts';
import { useSettings } from '../src/stores/settings.store.ts';
import type { MatchView } from '../src/api.ts';
import { ludoEngine } from '../../server/src/domains/match/engines/ludo.ts';
import type { LudoState } from '../../server/src/domains/match/ludo/state.ts';
import { client } from './fake-api.ts';

const position = (red: number[], yellow: number[], die: number): LudoState => ({
    v: 1,
    game: 'ludo',
    players: [
        { seat: 0, colour: 'red', pieces: red, out: false },
        { seat: 1, colour: 'yellow', pieces: yellow, out: false }
    ],
    turn: 0,
    die,
    sixes: die === 6 ? 1 : 0,
    rev: 1,
    winner: null
});

const ludo = (state: LudoState, watching = false): MatchView => ({
    id: 'match-1',
    tableId: 'table-1',
    game: 'ludo',
    rev: 1,
    seats: 2,
    players: [
        { seat: 0, who: 'alex', timeouts: 0 },
        { seat: 1, who: 'sara.k', timeouts: 0 }
    ] as MatchView['players'],
    turn: 0,
    mine: watching ? undefined : 0,
    startedAt: new Date(400_000).toISOString(),
    view: ludoEngine.view(state, watching ? null : 0) as MatchView['view']
});

const CAPTURE = position([10, -1, -1, -1], [38, -1, -1, -1], 2);

const SIX = position([10, -1, -1, -1], [-1, -1, -1, -1], 6);

const settle = async (): Promise<void> =>
{
    for (let step = 0; step < 10; step += 1)
    {
        await Promise.resolve();
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
};

const matches = client.matches as unknown as Record<string, unknown>;

const show = async (match: MatchView): Promise<HTMLElement> =>
{
    matches.view = async () => match;
    useBoard().open(match.id);
    await settle();
    return renderTest(() => MatchBoard({ match }) as HTMLElement).container;
};

const moveWords = (container: HTMLElement): string[] =>
    [...container.querySelectorAll('ul[aria-label] button')].map((button) => button.textContent?.trim() ?? '');

beforeEach(() =>
{
    cleanup();
    resetRuntime();
    setRuntime({ clock: manualClock(400_000), seed: 5 });
    useLocale().setLocale('en');
    useSettings().reset();
});

afterEach(() =>
{
    cleanup();
    useBoard().close();
    useSettings().reset();
    vi.restoreAllMocks();
    delete matches.view;
});

describe('the ludo helpers, and the switch for each', () =>
{
    it('says a move sends a named token home, and says only the move once told not to', async () =>
    {
        const locale = useLocale();
        const container = await show(ludo(CAPTURE));
        const name = usePeople().byHandle('sara.k')?.displayName ?? 'sara.k';

        expect(moveWords(container)).toEqual([locale.plural('helpers.ludo.move.capture', 1, { token: '1', name })]);

        useSettings().update({ hintOutcome: false });
        await settle();

        expect(moveWords(container)).toEqual([locale.t('match.move.step', { token: '1', die: '2' })]);
    });

    it('coaches the rule that matters, and goes quiet once told to', async () =>
    {
        const container = await show(ludo(SIX));
        const note = (): Element | null => container.querySelector('[role="note"]');

        expect(note()?.textContent).toContain(useLocale().t('helpers.ludo.tip.six'));

        useSettings().update({ hintRules: false });
        await settle();

        expect(note()).toBeNull();
    });

    it('lights the tokens that can move, and turning that off keeps every way to move', async () =>
    {
        const locale = useLocale();
        const container = await show(ludo(CAPTURE));
        const lit = (): number => container.querySelectorAll('.lp[data-movable]').length;

        for (let wait = 0; wait < 20 && container.querySelector('.lp') === null; wait += 1)
        {
            await settle();
        }

        expect(container.querySelectorAll('.lp')).toHaveLength(8);
        expect(lit()).toBe(1);
        expect(container.textContent).toContain(locale.t('match.hint.move'));

        useSettings().update({ hintMoves: false });
        await settle();

        expect(lit()).toBe(0);
        expect(moveWords(container)).toHaveLength(1);
        expect(container.textContent).toContain(locale.t('helpers.ludo.hint.move'));
    });

    it('moves the tip with the position, and explains a third six from the batch that ended the turn', async () =>
    {
        const locale = useLocale();
        const [batch, setBatch] = createSignal<EventBatch>({ seq: 0, events: [] });
        const [current, setCurrent] = createSignal(ludo(SIX));
        const props = {
            get match(): MatchView
            {
                return current();
            }
        };

        const animate = Element.prototype.animate;

        vi.spyOn(Element.prototype, 'animate').mockImplementation(function (this: Element, ...args: Parameters<Element['animate']>): Animation
        {
            const running = animate.apply(this, args);

            running.finished.catch(() => undefined);
            return running;
        });
        vi.spyOn(useBoard(), 'events').mockImplementation(batch);
        matches.view = async () => current();
        useBoard().open(current().id);
        await settle();

        const container = renderTest(() => MatchBoard(props) as HTMLElement).container;
        const note = (): string | null => container.querySelector('[role="note"]')?.textContent ?? null;

        expect(note()).toContain(locale.t('helpers.ludo.tip.six'));

        setCurrent(ludo(position([5, -1, -1, -1], [34, -1, -1, -1], 3)));
        await settle();

        expect(note()).toContain(locale.t('helpers.ludo.tip.star'));

        setCurrent({ ...ludo(position([10, -1, -1, -1], [3, -1, -1, -1], 6)), rev: 2, turn: 1, view: ludoEngine.view({ ...position([10, -1, -1, -1], [3, -1, -1, -1], 6), die: null, turn: 1 }, 0) as MatchView['view'] });
        setBatch({ seq: 1, events: [{ rev: 2, seat: 0, at: '', log: { kind: 'ludo', moves: [{ e: 'roll', seat: 0, die: 6 }, { e: 'pass', seat: 0, why: 'three-sixes' }] } }] });
        await settle();

        expect(note()).toContain(locale.t('helpers.ludo.tip.threeSixes'));

        setBatch({ seq: 2, events: [{ rev: 3, seat: 1, at: '', log: { kind: 'ludo', moves: [{ e: 'roll', seat: 1, die: 3 }] } }] });
        await settle();

        expect(note()).toBeNull();
    });

    it('tells somebody watching nothing about moves they do not have', async () =>
    {
        const container = await show(ludo(SIX, true));

        expect(container.querySelector('[role="note"]')).toBeNull();
        expect(moveWords(container)).toEqual([]);
    });
});
