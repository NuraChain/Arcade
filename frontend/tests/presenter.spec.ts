import { afterEach, describe, it, expect, vi } from 'vitest';

import { manualClock } from '../src/lib/clock.ts';
import { FAST } from '../src/game/stage/director.ts';
import type { Batch } from '../src/game/stage/feed.ts';
import { createPresenter, SETTLE, type Sight, type Table } from '../src/game/stage/presenter.ts';
import { createStage } from '../src/game/stage/stage.ts';

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

const setup = (hooked = true) =>
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

    const presenter = createPresenter<null, Move>({ stage, clock, table, sight: () => sight, report: (error) => reported.push(error) });

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

    it('is drawn again, with nothing played, when the tab is not on screen', () =>
    {
        const { presenter, calls, batch, at, opened } = setup();

        opened();
        hide();
        at(6);
        presenter.see(batch([6]));

        expect(calls).toEqual(['reset m1@6']);
        expect(presenter.presenting()).toBe(false);
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
