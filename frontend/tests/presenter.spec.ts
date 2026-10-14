import { afterEach, describe, it, expect, vi } from 'vitest';

import { manualClock } from '../src/lib/clock.ts';
import { FAST, HASTE, type Scene } from '../src/game/stage/director.ts';
import type { Batch } from '../src/game/stage/feed.ts';
import { BOX_SLACK, createPresenter, SETTLE, type Sight, type Table } from '../src/game/stage/presenter.ts';
import { createStage } from '../src/game/stage/stage.ts';
import { watchedBoxes } from './fake-boxes.ts';

interface Move
{
    e: string;
}

const ACT_MS = 500;

const HISTORY = 3000;

const flush = async () =>
{
    for (let turn = 0; turn < 12; turn += 1)
    {
        await Promise.resolve();
    }
};

const cost = (acts: readonly { moves: readonly Move[] }[]) => acts.reduce((sum, act) => sum + act.moves.length * ACT_MS, 0);

const setup = (hooked = true, lead?: () => number, due?: () => number | null) =>
{
    const clock = manualClock(1000);
    const stage = createStage({ clock, quiet: () => false });
    const calls: string[] = [];
    const reported: unknown[] = [];
    const told: boolean[] = [];
    const state = { shown: -1, breaks: false };
    let sight: Sight<null> | null = { id: 'm1', rev: 5, seat: 0, view: null };
    let seq = 0;

    const table: Table<null, Move> = {
        kind: 'test',
        history: HISTORY,

        reset(seen)
        {
            calls.push(`reset ${ seen.id }@${ seen.rev }`);
            state.shown = seen.rev;
        },

        same: (seen) => state.shown === seen.rev,

        async settle(seen, ctx)
        {
            calls.push(`settle ${ seen.rev }`);
            await ctx.stage.wait(100);
            state.shown = seen.rev;
        },

        async play(acts, seen, ctx)
        {
            if (state.breaks)
            {
                throw new Error('a scene that broke');
            }

            calls.push(`play ${ acts.map((act) => `${ act.rev }:${ act.moves.map((move) => move.e).join('+') }`).join(' ') }`);
            await ctx.stage.wait(cost(acts));
            state.shown = seen.rev;
            calls.push(`played ${ seen.rev }`);
        },

        estimate: cost,

        ...(hooked ? { before: (seen: Sight<null>) => ({ ...seen, rev: 0 }) } : {})
    };

    const presenter = createPresenter<null, Move>({
        stage,
        clock,
        table,
        sight: () => sight,
        report: (error) => reported.push(error),
        ...(lead === undefined ? {} : { lead }),
        ...(due === undefined ? {} : { due })
    });

    presenter.watch((busy) => told.push(busy));

    const batch = (revs: readonly number[], over: Partial<Batch> = {}, seat = 1, moves?: Move[]): Batch => ({
        seq: seq += 1,
        id: 'm1',
        events: revs.map((rev) => ({ rev, seat, log: { kind: 'test', moves: moves ?? [{ e: `e${ rev }` }] } })),
        live: true,
        jump: false,
        ...over
    });

    const at = (rev: number, id = 'm1') =>
    {
        sight = { id, rev, seat: 0, view: null };
    };

    const elapse = async (ms: number) =>
    {
        for (let left = ms; left > 0; left -= 5)
        {
            clock.advance(Math.min(5, left));
            await flush();
        }

        await flush();
    };

    const opened = () =>
    {
        presenter.see(batch([]));
        calls.length = 0;
    };

    return { presenter, calls, reported, told, state, clock, batch, at, elapse, opened, nothing: () => sight = null };
};

const hide = () => vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');

afterEach(() =>
{
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('a table, shown for the first time', () =>
{
    it('is drawn as it stands, and nothing that had already happened is played', () =>
    {
        const { presenter, calls, batch } = setup();

        presenter.see(batch([4, 5]));

        expect(calls).toEqual(['reset m1@5']);
        expect(presenter.presenting()).toBe(false);
    });

    it('waits for a board before it draws anything', () =>
    {
        const { presenter, calls, batch, nothing } = setup();

        nothing();
        presenter.see(batch([4, 5]));

        expect(calls).toEqual([]);
    });
});

describe('a move that arrives', () =>
{
    it('is played, with the board it leads to, and the table says it is busy for as long as that takes', async () =>
    {
        const { presenter, calls, told, batch, at, elapse, opened } = setup();

        opened();
        at(6);
        presenter.see(batch([6]));

        expect(calls).toEqual(['play 6:e6']);
        expect(presenter.presenting()).toBe(true);
        expect(told).toEqual([true]);

        await elapse(ACT_MS);

        expect(calls).toEqual(['play 6:e6', 'played 6']);
        expect(presenter.presenting()).toBe(false);
        expect(told).toEqual([true, false]);
    });

    it('is played once, however often the same batch is shown', () =>
    {
        const { presenter, calls, batch, at, opened } = setup();

        opened();
        at(6);

        const one = batch([6]);

        presenter.see(one);
        presenter.see(one);

        expect(calls).toEqual(['play 6:e6']);
    });

    it('waits its turn behind the one before it, and each is played to the board it arrived with', async () =>
    {
        const { presenter, calls, batch, at, elapse, opened } = setup();

        opened();
        at(6);
        presenter.see(batch([6]));
        at(8);
        presenter.see(batch([7, 8]));

        expect(calls).toEqual(['play 6:e6']);

        await elapse(ACT_MS);
        expect(calls).toEqual(['play 6:e6', 'played 6', 'play 7:e7 8:e8']);

        await elapse(ACT_MS * 2);
        expect(calls[calls.length - 1]).toBe('played 8');
    });

    it('is left out when the board in hand has not reached it', () =>
    {
        const { presenter, calls, batch, at, opened } = setup();

        opened();
        at(6);
        presenter.see(batch([6, 7]));

        expect(calls).toEqual(['play 6:e6']);
    });

    it('is ignored when it belongs to another game, and the next of this game is still played', () =>
    {
        const { presenter, calls, batch, at, opened } = setup();

        opened();
        presenter.see(batch([6], { id: 'm0' }));

        expect(calls).toEqual([]);

        at(6);
        presenter.see(batch([6]));

        expect(calls).toEqual(['play 6:e6']);
    });
});

describe('a table that cannot be told what happened', () =>
{
    it('is drawn again where the board stands when the store says the board jumped', () =>
    {
        const { presenter, calls, batch, at, opened } = setup();

        opened();
        at(9);
        presenter.see(batch([], { jump: true }));

        expect(calls).toEqual(['reset m1@9']);
    });

    it('is drawn again over a gap in what it was told', () =>
    {
        const { presenter, calls, batch, at, opened } = setup();

        opened();
        at(8);
        presenter.see(batch([8]));

        expect(calls).toEqual(['reset m1@8']);
    });

    it('stops what it is playing when the tab is hidden, and stands where the board does', async () =>
    {
        const { presenter, calls, clock, batch, at, elapse, opened } = setup();

        opened();
        at(6);
        presenter.see(batch([6]));
        await elapse(100);

        hide();
        document.dispatchEvent(new Event('visibilitychange'));

        expect(calls).toEqual(['play 6:e6', 'reset m1@6']);
        expect(presenter.presenting()).toBe(false);
        expect(clock.pending()).toBe(0);

        await elapse(ACT_MS);
        expect(calls).toEqual(['play 6:e6', 'reset m1@6']);
    });

    it('slides quietly to a board that moved with nothing said about it', async () =>
    {
        const { presenter, calls, batch, at, elapse, opened } = setup();
        const quiet = batch([]);

        opened();
        presenter.see(quiet);
        at(6);
        presenter.see(quiet);

        expect(calls).toEqual(['settle 6']);

        await elapse(SETTLE);
        presenter.see(quiet);

        expect(calls).toEqual(['settle 6']);
    });

    it('does nothing about a board that moved to where the table already stands', () =>
    {
        const { presenter, calls, state, batch, at, opened } = setup();
        const quiet = batch([]);

        opened();
        presenter.see(quiet);
        state.shown = 6;
        at(6);
        presenter.see(quiet);

        expect(calls).toEqual([]);
        expect(presenter.presenting()).toBe(false);
    });

    it('is drawn again when a scene breaks, and says what broke', async () =>
    {
        const { presenter, calls, reported, state, batch, at, elapse, opened } = setup();

        opened();
        state.breaks = true;
        at(6);
        presenter.see(batch([6]));
        await elapse(0);

        expect(reported).toHaveLength(1);
        expect(calls).toEqual(['reset m1@6']);
        expect(presenter.presenting()).toBe(false);
    });
});

describe('another match at the same table', () =>
{
    it('is drawn from nothing, and what the last one was playing is dropped', async () =>
    {
        const { presenter, calls, clock, batch, at, elapse, opened } = setup();

        opened();
        at(6);
        presenter.see(batch([6]));
        await elapse(100);

        at(1, 'm2');
        presenter.see(batch([1], { id: 'm2' }));

        expect(calls).toEqual(['play 6:e6', 'reset m2@1']);
        expect(clock.pending()).toBe(0);

        at(2, 'm2');
        presenter.see(batch([2], { id: 'm2' }));

        expect(calls).toEqual(['play 6:e6', 'reset m2@1', 'play 2:e2']);
    });
});

describe('catching up', () =>
{
    it('plays what was read to catch up when there is little of it', async () =>
    {
        const { presenter, calls, batch, at, elapse, opened } = setup();

        opened();
        at(7);
        presenter.see(batch([6, 7], { live: false }));

        expect(calls).toEqual(['play 6:e6 7:e7']);

        await elapse(ACT_MS * 2 - 5);
        expect(calls).toEqual(['play 6:e6 7:e7']);

        await elapse(5);
        expect(calls).toEqual(['play 6:e6 7:e7', 'played 7']);
    });

    it('plays it at double speed once what is in front of the newest move is far enough behind', async () =>
    {
        const { presenter, calls, batch, at, elapse, opened } = setup();

        opened();
        at(10);
        presenter.see(batch([6, 7, 8, 9, 10], { live: false }));

        await elapse(ACT_MS * 5 / FAST);

        expect(calls).toEqual(['play 6:e6 7:e7 8:e8 9:e9 10:e10', 'played 10']);
    });

    it('plays one move at its own pace however long it is, because the newest move is the present', async () =>
    {
        const { presenter, calls, batch, at, elapse, opened } = setup();

        opened();
        at(6);
        presenter.see(batch([6], {}, 1, [{ e: 'a' }, { e: 'b' }, { e: 'c' }, { e: 'd' }, { e: 'e' }]));

        await elapse(ACT_MS * 5 - 5);
        expect(calls).toEqual(['play 6:a+b+c+d+e']);

        await elapse(5);
        expect(calls).toEqual(['play 6:a+b+c+d+e', 'played 6']);
    });

    it('plays the newest move fast when the table is already far behind it', async () =>
    {
        const { presenter, calls, batch, at, elapse, opened } = setup();

        opened();
        at(9);
        presenter.see(batch([6, 7, 8, 9]));
        at(10);
        presenter.see(batch([10]));

        await elapse(ACT_MS * 4);
        expect(calls).toEqual(['play 6:e6 7:e7 8:e8 9:e9', 'played 9', 'play 10:e10']);

        await elapse(ACT_MS / FAST);
        expect(calls[calls.length - 1]).toBe('played 10');
    });

    it('goes straight to the board when there is too much to play', () =>
    {
        const { presenter, calls, batch, at, opened } = setup();

        opened();
        at(12);
        presenter.see(batch([6, 7, 8, 9, 10, 11, 12], { live: false }));

        expect(calls).toEqual(['reset m1@12']);
    });

    it('counts what is already waiting when it judges how much that is', async () =>
    {
        const { presenter, calls, batch, at, elapse, opened } = setup();

        opened();
        at(7);
        presenter.see(batch([6, 7]));
        await elapse(100);
        at(12);
        presenter.see(batch([8, 9, 10, 11, 12], { live: false }));

        expect(calls).toEqual(['play 6:e6 7:e7', 'reset m1@12']);
    });

    it('plays every move of a live batch that finds the table idle, however many came together', () =>
    {
        const { presenter, calls, batch, at, opened } = setup();

        opened();
        at(12);
        presenter.see(batch([6, 7, 8, 9, 10, 11, 12]));

        expect(calls).toEqual(['play 6:e6 7:e7 8:e8 9:e9 10:e10 11:e11 12:e12']);
    });

    it('goes straight to the board when moves arrive live faster than they can be shown, and plays on from there', async () =>
    {
        const { presenter, calls, batch, at, elapse, opened } = setup();
        const long = [{ e: 'a' }, { e: 'b' }, { e: 'c' }, { e: 'd' }, { e: 'e' }];
        let rev = 5;

        opened();

        while (!calls.some((call) => call.startsWith('reset')) && rev < 30)
        {
            rev += 1;
            at(rev);
            presenter.see(batch([rev], {}, 1, long));
        }

        expect(calls, 'the table went on queueing moves it was already seconds behind').toEqual(['play 6:a+b+c+d+e', `reset m1@${ rev }`]);
        expect(rev).toBeGreaterThan(8);
        expect(rev).toBeLessThan(12);
        expect(presenter.presenting()).toBe(false);

        at(rev + 1);
        presenter.see(batch([rev + 1]));
        await elapse(ACT_MS);

        expect(calls.slice(2)).toEqual([`play ${ rev + 1 }:e${ rev + 1 }`, `played ${ rev + 1 }`]);
    });
});

describe('what the reader did before the server said so', () =>
{
    const mine = [{ e: 'mine' }, { e: 'theirs' }];

    it('is played at once, at its own pace, and what was in front of it is hastened', async () =>
    {
        const { presenter, calls, batch, at, elapse, opened } = setup();
        const pressed: string[] = [];

        opened();
        at(6);
        presenter.see(batch([6]));
        await elapse(100);

        presenter.act(async (ctx) =>
        {
            pressed.push('started');
            await ctx.stage.wait(200);
            pressed.push('ended');
        });

        expect(pressed).toEqual([]);

        await elapse(100);
        expect(calls).toEqual(['play 6:e6', 'played 6']);
        expect(pressed).toEqual(['started']);

        await elapse(200);
        expect(pressed).toEqual(['started', 'ended']);
    });

    it('starts in the turn of the press when nothing is playing', () =>
    {
        const { presenter, opened } = setup();
        let started = false;

        opened();
        presenter.act(() =>
        {
            started = true;
        });

        expect(started).toBe(true);
    });

    it('is taken out of the answer to it, so it is not played a second time', () =>
    {
        const { presenter, calls, batch, at, opened } = setup();

        opened();
        presenter.predict({ rev: 5, covers: (moves) => (moves[0]?.e === 'mine' ? 1 : null) });
        at(6);
        presenter.see(batch([6], {}, 0, mine));

        expect(calls).toEqual(['play 6:theirs']);
    });

    it('is forgotten once it is answered', async () =>
    {
        const { presenter, calls, batch, at, elapse, opened } = setup();

        opened();
        presenter.predict({ rev: 5, covers: () => 1 });
        at(6);
        presenter.see(batch([6], {}, 0, mine));
        await elapse(ACT_MS);
        at(7);
        presenter.see(batch([7], {}, 0, mine));

        expect(calls).toEqual(['play 6:theirs', 'played 6', 'play 7:mine+theirs']);
    });

    it('is given up, and the table drawn again, when the answer is not what the reader did', () =>
    {
        const { presenter, calls, batch, at, opened } = setup();

        opened();
        presenter.predict({ rev: 5, covers: () => null });
        at(6);
        presenter.see(batch([6], {}, 0, mine));

        expect(calls).toEqual(['reset m1@6']);
    });

    it('is given up when somebody else\'s move arrives instead of the answer', () =>
    {
        const { presenter, calls, batch, at, opened } = setup();

        opened();
        presenter.predict({ rev: 5, covers: () => 1 });
        at(6);
        presenter.see(batch([6], {}, 1, mine));

        expect(calls).toEqual(['reset m1@6']);
    });

    it('can be taken back before anything is sent', () =>
    {
        const { presenter, calls, batch, at, opened } = setup();

        opened();
        presenter.predict({ rev: 5, covers: () => 1 });
        presenter.predict(null);
        at(6);
        presenter.see(batch([6], {}, 0, mine));

        expect(calls).toEqual(['play 6:mine+theirs']);
    });
});

describe('a table that is given only so long', () =>
{
    const LONG = [6, 7, 8, 9];

    const HASTENED = (ACT_MS * 2) / HASTE;

    it('hastens what it still has to show when its time is up', async () =>
    {
        const { presenter, calls, batch, at, elapse, opened, reported } = setup(true, undefined, () => 1000);

        opened();
        at(9);
        presenter.see(batch(LONG));
        await elapse(1000 + HASTENED - 10);

        expect(calls, 'the rest was shown faster than a table in haste shows it').toEqual(['play 6:e6 7:e7 8:e8 9:e9']);

        await elapse(15);

        expect(calls[calls.length - 1], 'the table went on at its own pace when its time was up').toBe('played 9');
        expect(presenter.presenting()).toBe(false);
        expect(reported).toEqual([]);
    });

    it('is hastened once, when the time first given is up, however often it hears something more', async () =>
    {
        const { presenter, calls, batch, at, elapse, opened, told, clock } = setup(true, undefined, () => 1000);

        opened();
        at(9);
        presenter.see(batch(LONG));
        await elapse(300);
        presenter.see(batch([]));
        await elapse(300);
        presenter.see(batch([]));
        await elapse(400 + HASTENED - 10);

        expect(calls, 'hearing more gave the table more time, or less').toEqual(['play 6:e6 7:e7 8:e8 9:e9']);

        await elapse(15);

        expect(calls[calls.length - 1]).toBe('played 9');

        await elapse(2000);

        expect(told, 'a count nobody was keeping ran out on a table with nothing to show').toEqual([true, false]);
        expect(clock.pending()).toBe(0);
    });

    it('leaves a table alone that shows what it has in time, and keeps no count running for it', async () =>
    {
        const { presenter, calls, batch, at, elapse, opened, clock } = setup(true, undefined, () => 1000);

        opened();
        at(6);
        presenter.see(batch([6]));
        await elapse(ACT_MS);

        expect(calls).toEqual(['play 6:e6', 'played 6']);
        expect(clock.pending(), 'a count was left running for a table with nothing left to show').toBe(0);
    });

    it('counts afresh for what arrives once it has caught up', async () =>
    {
        const { presenter, calls, batch, at, elapse, opened } = setup(true, undefined, () => 1000);

        opened();
        at(6);
        presenter.see(batch([6]));
        await elapse(600);
        at(10);
        presenter.see(batch([7, 8, 9, 10]));
        await elapse(1000 + HASTENED - 10);

        expect(calls[calls.length - 1], 'the count of a table that had caught up was still running, and cut the next thing short').toBe('play 7:e7 8:e8 9:e9 10:e10');

        await elapse(15);

        expect(calls[calls.length - 1]).toBe('played 10');
    });

    it('asks how long only when it has heard something and has something to show', async () =>
    {
        let asked = 0;

        const { presenter, batch, at, elapse, opened } = setup(true, undefined, () =>
        {
            asked += 1;

            return 1000;
        });

        opened();

        expect(asked, 'a table with nothing to show was asked how long it had').toBe(0);

        at(6);
        presenter.see(batch([6]));

        expect(asked).toBe(1);

        await elapse(ACT_MS + 2000);

        expect(asked, 'the table went on asking with nothing heard').toBe(1);
    });

    it('lets a table take as long as it likes once nothing says otherwise', async () =>
    {
        let limit: number | null = 1000;

        const { presenter, calls, batch, at, elapse, opened } = setup(true, undefined, () => limit);

        opened();
        at(9);
        presenter.see(batch(LONG));
        await elapse(500);

        limit = null;
        presenter.see(batch([]));
        await elapse(ACT_MS * 4 - 500 - 10);

        expect(calls, 'a count that had been taken back still ran out').toEqual(['play 6:e6 7:e7 8:e8 9:e9']);

        await elapse(15);

        expect(calls[calls.length - 1]).toBe('played 9');
    });

    it('is never hastened where nobody said how long it has', async () =>
    {
        const { presenter, calls, batch, at, elapse, opened } = setup();

        opened();
        at(9);
        presenter.see(batch(LONG));
        await elapse(ACT_MS * 4 - 10);

        expect(calls).toEqual(['play 6:e6 7:e7 8:e8 9:e9']);
    });
});

describe('the opening of a game', () =>
{
    const token = () =>
    {
        let asked = 0;

        return { opens: () => (asked += 1) === 1, asked: () => asked };
    };

    it('is played from the table as it stood before it, when it was delivered here and the board has not moved past it', async () =>
    {
        const { presenter, calls, batch, at, elapse } = setup();

        at(1);
        presenter.see(batch([1], { opens: token().opens }));

        expect(calls).toEqual(['reset m1@0', 'play 1:e1']);
        expect(presenter.presenting()).toBe(true);

        await elapse(ACT_MS);

        expect(calls).toEqual(['reset m1@0', 'play 1:e1', 'played 1']);
        expect(presenter.presenting()).toBe(false);
    });

    it('waits as long as the board asks before it is played, on a table already drawn as it stood before', async () =>
    {
        let asked = 0;

        const { presenter, calls, batch, at, elapse } = setup(true, () =>
        {
            asked += 1;

            return 240;
        });

        at(1);
        presenter.see(batch([1], { opens: token().opens }));

        expect(calls, 'the table was not drawn as it stood before the opening at once').toEqual(['reset m1@0']);
        expect(presenter.presenting(), 'a table that is waiting to open said it was idle').toBe(true);

        await elapse(230);

        expect(calls, 'the opening did not wait').toEqual(['reset m1@0']);

        await elapse(15);

        expect(calls).toEqual(['reset m1@0', 'play 1:e1']);

        await elapse(ACT_MS);

        expect([calls, presenter.presenting(), asked]).toEqual([['reset m1@0', 'play 1:e1', 'played 1'], false, 1]);
    });

    it('asks for no wait where none is wanted, and asks nothing for a move that is not an opening', async () =>
    {
        let asked = 0;

        const none = setup(true, () => 0);

        none.at(1);
        none.presenter.see(none.batch([1], { opens: token().opens }));

        expect(none.calls, 'an opening with nothing to wait for did not start at once').toEqual(['reset m1@0', 'play 1:e1']);

        const later = setup(true, () =>
        {
            asked += 1;

            return 240;
        });

        later.opened();
        later.at(6);
        later.presenter.see(later.batch([6]));

        expect([later.calls, asked]).toEqual([['play 6:e6'], 0]);
    });

    it('counts the wait among what the table is behind by, when an opening comes with moves after it', async () =>
    {
        const late = setup(true, () => 240);
        const prompt = setup(true);

        late.at(4);
        late.presenter.see(late.batch([1, 2, 3, 4], { opens: token().opens }));
        prompt.at(4);
        prompt.presenter.see(prompt.batch([1, 2, 3, 4], { opens: token().opens }));

        await late.elapse(240);
        await prompt.elapse((ACT_MS * 4) / FAST);

        expect(prompt.calls, 'three moves in front of the newest were taken for more than the table may be behind').toEqual(['reset m1@0', 'play 1:e1 2:e2 3:e3 4:e4']);
        expect(late.calls).toEqual(['reset m1@0', 'play 1:e1 2:e2 3:e3 4:e4']);

        await late.elapse((ACT_MS * 4) / FAST);

        expect(late.calls[late.calls.length - 1], 'the wait was not counted, and the table fell further behind for it').toBe('played 4');
    });

    it('is played once: a table put on the page a second time is drawn as it stands', () =>
    {
        const first = setup();
        const second = setup();
        const once = token();
        const opening = first.batch([1], { opens: once.opens });

        first.at(1);
        first.presenter.see(opening);
        second.at(1);
        second.presenter.see(opening);

        expect(first.calls).toEqual(['reset m1@0', 'play 1:e1']);
        expect(second.calls).toEqual(['reset m1@1']);
    });

    it('is drawn as it stands when the board in hand has moved past it, and is not kept for a later table', () =>
    {
        const { presenter, calls, batch, at } = setup();
        const once = token();

        at(2);
        presenter.see(batch([1], { opens: once.opens }));

        expect(calls).toEqual(['reset m1@2']);
        expect(once.asked()).toBe(1);
    });

    it('is drawn as it stands in a tab that is not on screen', () =>
    {
        const { presenter, calls, batch, at } = setup();

        hide();
        at(1);
        presenter.see(batch([1], { opens: token().opens }));

        expect(calls).toEqual(['reset m1@1']);
    });

    it('is drawn as it stands at a table that cannot say how it stood before', () =>
    {
        const { presenter, calls, batch, at } = setup(false);

        at(1);
        presenter.see(batch([1], { opens: token().opens }));

        expect(calls).toEqual(['reset m1@1']);
    });

    it('is left for its own game when it is another game\'s', () =>
    {
        const { presenter, calls, batch, at } = setup();
        const once = token();

        at(1);
        presenter.see(batch([1], { id: 'm2', opens: once.opens }));

        expect(calls).toEqual(['reset m1@1']);
        expect(once.asked()).toBe(0);
    });

    it('does not take a table already on the page back to the start, and is used up all the same', () =>
    {
        const { presenter, calls, batch, at, opened } = setup();
        const once = token();

        at(1);
        opened();
        presenter.see(batch([1], { opens: once.opens }));

        expect(calls).toEqual([]);
        expect(once.asked()).toBe(1);
        expect(once.opens(), 'the opening was left for the next table to play late').toBe(false);
    });

    it('is followed by the next move as any move is', async () =>
    {
        const { presenter, calls, batch, at, elapse } = setup();

        at(1);
        presenter.see(batch([1], { opens: token().opens }));
        await elapse(ACT_MS);
        at(2);
        presenter.see(batch([2]));

        expect(calls.slice(3)).toEqual(['play 2:e2']);
    });
});

describe('a table whose box changes size', () =>
{
    const flying = (clock: { now(): number }) =>
    {
        const heard: string[] = [];
        const piece = document.createElement('div');

        const play: Scene = async (ctx) =>
        {
            await ctx.stage.animate(piece, [{ translate: '0px' }, { translate: '100px' }], { duration: 400, landed: () => heard.push(`landed at ${ clock.now() }`) }).done;
            heard.push(`on at ${ clock.now() }`);
            await ctx.stage.wait(300);
            heard.push(`done at ${ clock.now() }`);
        };

        return { heard, play };
    };

    it('lands what is in the air at once when that happens under what it is playing, and plays the rest of it', async () =>
    {
        const boxes = watchedBoxes();
        const { presenter, calls, clock, elapse, opened } = setup();
        const box = document.createElement('div');
        const { heard, play } = flying(clock);

        presenter.frame(box);
        boxes.size(box, 800, 600);
        opened();
        presenter.act(play, 700);
        await elapse(100);

        expect(boxes.watching(box)).toBe(1);
        expect(heard).toEqual([]);

        boxes.size(box, 640, 600);
        await flush();

        expect(heard, 'a move measured on a table of one size went on being played on another').toEqual(['landed at 1100', 'on at 1100']);
        expect(calls, 'the table was drawn again, and what it had still to show was thrown away').toEqual([]);
        expect(presenter.presenting()).toBe(true);

        await elapse(300);

        expect(heard.at(-1)).toBe('done at 1400');
        expect(presenter.presenting()).toBe(false);
    });

    it('takes the first size it is told as where it starts, and a pixel either way as no change', async () =>
    {
        const boxes = watchedBoxes();
        const { presenter, clock, elapse, opened } = setup();
        const box = document.createElement('div');
        const { heard, play } = flying(clock);

        presenter.frame(box);
        opened();
        presenter.act(play, 700);
        await elapse(100);

        boxes.size(box, 800, 600);
        boxes.size(box, 800 + BOX_SLACK, 600 - BOX_SLACK);
        boxes.size(box, 800 - BOX_SLACK, 600 + BOX_SLACK);
        await flush();

        expect(heard, 'the first measure, or the browser rounding one, landed a move').toEqual([]);

        boxes.size(box, 800, 600 + BOX_SLACK + 0.5);
        await flush();

        expect(heard, 'a box that grew a pixel at a time was never seen to have grown').toEqual(['landed at 1100', 'on at 1100']);
    });

    it('measures a height as it measures a width', async () =>
    {
        const boxes = watchedBoxes();
        const { presenter, clock, elapse, opened } = setup();
        const box = document.createElement('div');
        const { heard, play } = flying(clock);

        presenter.frame(box);
        boxes.size(box, 800, 600);
        opened();
        presenter.act(play, 700);
        await elapse(100);
        boxes.size(box, 800, 420);
        await flush();

        expect(heard).toEqual(['landed at 1100', 'on at 1100']);
    });

    it('leaves alone a table that is playing nothing, and a move with nothing in the air', async () =>
    {
        const boxes = watchedBoxes();
        const idle = setup();
        const box = document.createElement('div');

        idle.presenter.frame(box);
        boxes.size(box, 800, 600);
        idle.opened();
        boxes.size(box, 500, 600);

        expect(idle.calls, 'a table at rest was drawn again for a box that changed').toEqual([]);

        const { presenter, calls, batch, at, elapse, opened } = setup();
        const other = document.createElement('div');

        presenter.frame(other);
        boxes.size(other, 800, 600);
        opened();
        at(6);
        presenter.see(batch([6]));
        await elapse(100);
        boxes.size(other, 500, 600);

        expect(presenter.presenting(), 'a hold on the table was cut short for a box that changed').toBe(true);

        await elapse(ACT_MS - 100);
        at(7);
        presenter.see(batch([7]));
        await elapse(ACT_MS);

        expect(calls, 'the move was not played to its end, or the next one not after it').toEqual(['play 6:e6', 'played 6', 'play 7:e7', 'played 7']);
    });

    it('stops watching a box when it is given another, when it is given none, and when it is taken away', () =>
    {
        const boxes = watchedBoxes();
        const { presenter } = setup();
        const first = document.createElement('div');
        const second = document.createElement('div');

        presenter.frame(first);
        presenter.frame(second);

        expect([boxes.watching(first), boxes.watching(second)]).toEqual([0, 1]);

        presenter.frame(null);

        expect(boxes.watching(second)).toBe(0);
        expect(boxes.all).toHaveLength(2);

        presenter.frame(second);
        presenter.dispose();

        expect(boxes.watching(second)).toBe(0);
    });

    it('forgets the size of the box before when it is given another', async () =>
    {
        const boxes = watchedBoxes();
        const { presenter, clock, elapse, opened } = setup();
        const first = document.createElement('div');
        const second = document.createElement('div');
        const { heard, play } = flying(clock);

        presenter.frame(first);
        boxes.size(first, 800, 600);
        opened();
        presenter.act(play, 700);
        await elapse(100);
        presenter.frame(second);
        boxes.size(second, 300, 200);
        await flush();

        expect(heard, 'the first measure of a new box was held against the last of the old').toEqual([]);
    });

    it('plays on in a browser that cannot watch a box', async () =>
    {
        vi.stubGlobal('ResizeObserver', undefined);

        const { presenter, calls, batch, at, elapse, opened } = setup();

        presenter.frame(document.createElement('div'));
        opened();
        at(6);
        presenter.see(batch([6]));
        await elapse(ACT_MS);

        expect(calls).toEqual(['play 6:e6', 'played 6']);
    });
});

describe('a table in a tab that is not on screen', () =>
{
    const show = (looking: ReturnType<typeof hide>) =>
    {
        looking.mockReturnValue('visible');
        document.dispatchEvent(new Event('visibilitychange'));
    };

    it('keeps what happens there, and plays it when the tab is shown again', async () =>
    {
        const { presenter, calls, told, batch, at, elapse, opened } = setup();

        opened();

        const looking = hide();

        at(6);
        presenter.see(batch([6]));
        await elapse(ACT_MS * 4);

        expect(calls, 'a move was played, or the board drawn past it, where nobody could see it').toEqual([]);
        expect(presenter.presenting(), 'the board was said to be level with a move it has not shown').toBe(true);
        expect(told).toEqual([true]);

        show(looking);

        expect(calls).toEqual(['play 6:e6']);

        await elapse(ACT_MS);

        expect(calls).toEqual(['play 6:e6', 'played 6']);
        expect(presenter.presenting()).toBe(false);
        expect(told).toEqual([true, false]);
    });

    it('plays all it kept in one go, and fast when there is a lot of it', async () =>
    {
        const { presenter, calls, batch, at, elapse, opened } = setup();

        opened();

        const looking = hide();

        for (const rev of [6, 7, 8, 9, 10])
        {
            at(rev);
            presenter.see(batch([rev]));
        }

        show(looking);
        await elapse((ACT_MS * 5) / FAST - 5);

        expect(calls).toEqual(['play 6:e6 7:e7 8:e8 9:e9 10:e10']);

        await elapse(5);

        expect(calls).toEqual(['play 6:e6 7:e7 8:e8 9:e9 10:e10', 'played 10']);
    });

    it('keeps only the newest of it that the table has time to show, from the board as it stood before', async () =>
    {
        const { presenter, calls, batch, at, elapse, opened } = setup();

        opened();

        const looking = hide();

        for (const rev of [6, 7, 8, 9, 10, 11, 12])
        {
            at(rev);
            presenter.see(batch([rev]));
        }

        expect(calls).toEqual(['reset m1@6']);
        expect(presenter.presenting()).toBe(true);

        show(looking);
        await elapse(ACT_MS * 6);

        expect(calls).toEqual(['reset m1@6', 'play 7:e7 8:e8 9:e9 10:e10 11:e11 12:e12', 'played 12']);
    });

    it('draws the board as it stands when one move is longer than the table would ever play back', () =>
    {
        const { presenter, calls, told, batch, at, opened } = setup();

        opened();

        const looking = hide();

        at(6);
        presenter.see(batch([6], {}, 1, Array.from({ length: 7 }, (_, index) => ({ e: `e${ index }` }))));

        expect(calls).toEqual(['reset m1@6']);
        expect(presenter.presenting()).toBe(false);
        expect(told).toEqual([]);

        show(looking);

        expect(calls).toEqual(['reset m1@6']);
    });

    it('draws the board as it stands over a gap, and keeps what comes after it', async () =>
    {
        const { presenter, calls, batch, at, elapse, opened } = setup();

        opened();

        const looking = hide();

        at(6);
        presenter.see(batch([6]));
        at(8);
        presenter.see(batch([8]));
        at(9);
        presenter.see(batch([9]));

        expect(calls).toEqual(['reset m1@8']);

        show(looking);
        await elapse(ACT_MS);

        expect(calls).toEqual(['reset m1@8', 'play 9:e9', 'played 9']);
    });

    it('draws the board as it stands when it moved with nothing said about it', () =>
    {
        const { presenter, calls, batch, at, opened } = setup();

        opened();

        const looking = hide();

        at(6);
        presenter.see(batch([6]));
        at(7);
        presenter.see(batch([]));

        expect(calls).toEqual(['reset m1@7']);
        expect(presenter.presenting()).toBe(false);

        show(looking);

        expect(calls).toEqual(['reset m1@7']);
    });

    it('draws the board as it stands when the answer to the reader\'s own press comes while the tab is away', () =>
    {
        const { presenter, calls, batch, at, opened } = setup();

        opened();
        presenter.predict({ rev: 5, covers: () => 1 });

        const looking = hide();

        at(6);
        presenter.see(batch([6], {}, 0, [{ e: 'mine' }, { e: 'theirs' }]));

        expect(calls).toEqual(['reset m1@6']);

        show(looking);

        expect(calls).toEqual(['reset m1@6']);
    });

    it('forgets what it kept when the table moves on to another game', () =>
    {
        const { presenter, calls, batch, at, opened } = setup();

        opened();

        const looking = hide();

        at(6);
        presenter.see(batch([6]));
        at(1, 'm2');
        presenter.see(batch([1], { id: 'm2' }));

        expect(calls).toEqual(['reset m2@1']);

        show(looking);

        expect(calls).toEqual(['reset m2@1']);
    });

    it('plays what it kept before a move that arrives once the tab is back, even unannounced', async () =>
    {
        const { presenter, calls, batch, at, elapse, opened } = setup();

        opened();

        const looking = hide();

        at(6);
        presenter.see(batch([6]));
        looking.mockReturnValue('visible');
        at(7);
        presenter.see(batch([7]));
        await elapse(ACT_MS * 2);

        expect(calls).toEqual(['play 6:e6', 'played 6', 'play 7:e7', 'played 7']);
    });

    it('forgets what it kept when it is taken away, and says it is done', () =>
    {
        const { presenter, calls, told, batch, at, opened } = setup();

        opened();

        const looking = hide();

        at(6);
        presenter.see(batch([6]));
        presenter.dispose();

        expect(told).toEqual([true, false]);

        show(looking);

        expect(calls).toEqual([]);
    });
});

describe('a table that is taken away', () =>
{
    it('stops what it is playing and no longer listens for the tab', async () =>
    {
        const { presenter, calls, clock, batch, at, elapse, opened } = setup();

        opened();
        at(6);
        presenter.see(batch([6]));
        await elapse(100);
        presenter.dispose();

        expect(clock.pending()).toBe(0);

        hide();
        document.dispatchEvent(new Event('visibilitychange'));

        expect(calls).toEqual(['play 6:e6']);
    });
});
