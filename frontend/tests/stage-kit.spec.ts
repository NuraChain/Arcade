import { afterEach, describe, it, expect, vi } from 'vitest';

import { manualClock } from '../src/lib/clock.ts';
import { TIMING } from '../src/game/motion.ts';
import { FAST, HASTE, LINGER_FLOOR, OVERRUN, OVERRUN_GRACE, createDirector } from '../src/game/stage/director.ts';
import { actsOf, runOf } from '../src/game/stage/feed.ts';
import { LAYER, layered } from '../src/game/stage/layers.ts';
import { arc, walk } from '../src/game/stage/route.ts';
import { createStage } from '../src/game/stage/stage.ts';

const flush = async () =>
{
    for (let turn = 0; turn < 12; turn += 1)
    {
        await Promise.resolve();
    }
};

const rig = (quiet = false) =>
{
    const clock = manualClock(1000);
    const failed: unknown[] = [];
    const stage = createStage({ clock, quiet: () => quiet, report: (error) => failed.push(error) });

    return { clock, stage, failed, elapse: async (ms: number) =>
    {
        for (let left = ms; left > 0; left -= 5)
        {
            clock.advance(Math.min(5, left));
            await flush();
        }

        await flush();
    } };
};

const timed = (clock: { now(): number }) =>
{
    const started = clock.now();
    const seen: [string, number][] = [];

    return { seen, mark: (name: string) =>
    {
        seen.push([name, clock.now() - started]);
    } };
};

afterEach(() =>
{
    vi.restoreAllMocks();
});

describe('the stage', () =>
{
    it('finishes a run when its own time is up, on the product clock', async () =>
    {
        const { stage, elapse } = rig();
        let done = false;

        void stage.animate(document.createElement('div'), [{ opacity: 0 }, { opacity: 1 }], { duration: 300 }).done.then(() =>
        {
            done = true;
        });

        await elapse(295);
        expect(done).toBe(false);

        await elapse(5);
        expect(done).toBe(true);
    });

    it('counts a delay as part of the run, and says how long the whole of it is', async () =>
    {
        const { stage, elapse } = rig();
        const run = stage.animate(document.createElement('div'), [{ opacity: 0 }, { opacity: 1 }], { duration: 200, delay: 100 });
        let done = false;

        void run.done.then(() =>
        {
            done = true;
        });

        expect(run.length).toBe(300);

        await elapse(295);
        expect(done).toBe(false);

        await elapse(5);
        expect(done).toBe(true);
    });

    it('tells a run\'s own landing before whoever waits for the run, and nothing of a run that was stopped', async () =>
    {
        const { stage, elapse } = rig();
        const told: string[] = [];
        const frames = [{ opacity: 0 }, { opacity: 1 }];
        const run = stage.animate(document.createElement('div'), frames, { duration: 200, landed: () => told.push('landed') });

        void run.done.then(() => told.push('done'));

        await elapse(195);
        expect(told).toEqual([]);

        await elapse(5);
        expect(told).toEqual(['landed', 'done']);

        stage.animate(document.createElement('div'), frames, { duration: 200, landed: () => told.push('stopped') }).cancel();
        await elapse(250);
        stage.animate(document.createElement('div'), frames, { duration: 200, landed: () => told.push('cleared') });
        stage.clear();
        await elapse(250);

        expect(told, 'a run that never arrived said it had landed').toEqual(['landed', 'done']);

        stage.animate(document.createElement('div'), frames, { duration: 200, landed: () => told.push('finished') }).finish();
        await flush();

        expect(told).toEqual(['landed', 'done', 'finished']);
    });

    it('reports a landing that throws, and the run is done all the same', async () =>
    {
        const { stage, elapse, failed } = rig();
        let done = false;

        void stage.animate(document.createElement('div'), [{ opacity: 0 }, { opacity: 1 }], {
            duration: 100,
            landed: () =>
            {
                throw new Error('the landing broke');
            }
        }).done.then(() =>
        {
            done = true;
        });

        await elapse(100);

        expect(done).toBe(true);
        expect(failed.map(String)).toEqual(['Error: the landing broke']);
    });

    it('takes a run already in flight to a new pace, from where it had got to', async () =>
    {
        const { stage, elapse } = rig();
        const animate = vi.spyOn(Element.prototype, 'animate');
        let done = false;

        void stage.animate(document.createElement('div'), [{ opacity: 0 }, { opacity: 1 }], { duration: 400 }).done.then(() =>
        {
            done = true;
        });

        await elapse(100);
        stage.pace(2);

        expect((animate.mock.results[0].value as Animation).playbackRate).toBe(2);

        await elapse(145);
        expect(done).toBe(false);

        await elapse(5);
        expect(done).toBe(true);
    });

    it('starts a run at the pace the stage is already at', async () =>
    {
        const { stage, elapse } = rig();
        const animate = vi.spyOn(Element.prototype, 'animate');
        let done = false;

        stage.pace(4);
        void stage.animate(document.createElement('div'), [{ opacity: 0 }, { opacity: 1 }], { duration: 400 }).done.then(() =>
        {
            done = true;
        });

        expect((animate.mock.results[0].value as Animation).playbackRate).toBe(4);

        await elapse(100);
        expect(done).toBe(true);
    });

    it('re-arms a timer at the new pace, and keeps every timer in the order it was due', async () =>
    {
        const { stage, clock, elapse } = rig();
        const { seen, mark } = timed(clock);

        stage.after(900, () => mark('last'));
        stage.after(100, () => mark('first'));
        stage.after(500, () => mark('middle'));

        await elapse(50);
        stage.pace(4);
        await elapse(400);

        expect(seen.map(([name]) => name)).toEqual(['first', 'middle', 'last']);
        expect(seen[0][1]).toBeLessThanOrEqual(65);
        expect(seen[1][1]).toBeGreaterThan(seen[0][1]);
        expect(seen[2][1]).toBeGreaterThan(seen[1][1]);
        expect(seen[2][1]).toBeLessThanOrEqual(265);
    });

    it('lets a run be cancelled, and then it has finished as far as anybody waiting is concerned', async () =>
    {
        const { stage, clock, elapse } = rig();
        const run = stage.animate(document.createElement('div'), [{ opacity: 0 }, { opacity: 1 }], { duration: 5000 });
        let done = false;

        void run.done.then(() =>
        {
            done = true;
        });

        run.cancel();
        await elapse(0);

        expect(done).toBe(true);
        expect(clock.pending()).toBe(0);
    });

    it('does not mind being finished twice, or after it ended by itself', async () =>
    {
        const { stage, clock, elapse } = rig();
        const run = stage.animate(document.createElement('div'), [{ opacity: 0 }, { opacity: 1 }], { duration: 50 });

        await elapse(50);
        run.finish();
        run.cancel();

        expect(clock.pending()).toBe(0);
    });

    it('takes back what a run still holds when it is cancelled after it has ended', async () =>
    {
        const { stage, elapse } = rig();
        const cancelled = vi.fn();
        const finished = vi.fn();

        vi.spyOn(Element.prototype, 'animate').mockImplementation(() => ({
            cancel: cancelled,
            finish: finished,
            finished: Promise.resolve(),
            updatePlaybackRate: () => undefined
        }) as unknown as Animation);

        const run = stage.animate(document.createElement('div'), [{ opacity: 1 }, { opacity: 0 }], { duration: 50, fill: 'both' });

        await elapse(50);

        expect(finished).toHaveBeenCalledTimes(1);
        expect(cancelled, 'ending is not cancelling: what fills stays until somebody asks').not.toHaveBeenCalled();

        run.cancel();

        expect(cancelled, 'a thing that had faded out stayed out for good').toHaveBeenCalledTimes(1);

        run.cancel();
        run.finish();

        expect(cancelled).toHaveBeenCalledTimes(1);
        expect(finished).toHaveBeenCalledTimes(1);
    });

    it('drops every run, wait and timer when it is cleared, and none of them comes back', async () =>
    {
        const { stage, clock, elapse } = rig();
        const fired: string[] = [];

        void stage.wait(10_000).then(() => fired.push('wait'));
        void stage.animate(document.createElement('div'), [{ opacity: 0 }, { opacity: 1 }], { duration: 400 }).done.then(() => fired.push('run'));
        stage.after(100, () => fired.push('kept'));
        stage.after(400, () => fired.push('dropped'));

        await elapse(100);
        expect(fired).toEqual(['kept']);

        stage.clear();
        expect(clock.pending()).toBe(0);

        await elapse(20_000);
        expect(fired).toEqual(['kept']);
    });

    it('leaves the page alone when it is cleared: it removes nothing it was not handed', () =>
    {
        const { stage } = rig();
        const host = document.createElement('div');
        const piece = document.createElement('span');

        host.append(piece);
        document.body.append(host);
        stage.animate(piece, [{ opacity: 0 }, { opacity: 1 }], { duration: 400 });
        stage.clear();

        expect(piece.isConnected).toBe(true);
        expect(host.children.length).toBe(1);
        host.remove();
    });

    it('says so when a timer throws, and goes on to the next one', async () =>
    {
        const { stage, failed, elapse } = rig();
        const fired: string[] = [];

        stage.after(10, () =>
        {
            throw new Error('a cue that broke');
        });
        stage.after(20, () => fired.push('after it'));

        await elapse(20);

        expect(failed).toHaveLength(1);
        expect(fired).toEqual(['after it']);
    });
});

describe('the stage, for somebody who asked for less motion', () =>
{
    it('turns a run into a short fade where the thing ends up, and keeps its delay', async () =>
    {
        const { stage, elapse } = rig(true);
        const animate = vi.spyOn(Element.prototype, 'animate');
        const run = stage.animate(document.createElement('div'), [{ translate: '0px 0px' }, { translate: '300px 0px' }], { duration: 600, delay: 200, easing: 'ease-out' });
        let done = false;

        void run.done.then(() =>
        {
            done = true;
        });

        expect(animate.mock.calls[0][0]).toEqual([{ opacity: 0, offset: 0 }]);
        expect(animate.mock.calls[0][1]).toMatchObject({ duration: TIMING.FADE, delay: 200, easing: 'linear', fill: 'backwards' });
        expect(run.length).toBe(200 + TIMING.FADE);

        await elapse(200 + TIMING.FADE - 5);
        expect(done).toBe(false);

        await elapse(5);
        expect(done).toBe(true);
    });

    it('fades out something that ends in nothing, and leaves it gone', () =>
    {
        const { stage } = rig(true);
        const animate = vi.spyOn(Element.prototype, 'animate');

        stage.animate(document.createElement('div'), [{ scale: '1' }, { scale: '0.6', opacity: 0 }], { duration: 200, quiet: 'out' });

        expect(animate.mock.calls[0][0]).toEqual([{ opacity: 0, offset: 1 }]);
        expect(animate.mock.calls[0][1]).toMatchObject({ duration: TIMING.FADE, fill: 'both' });
    });

    it('leaves out what is only a flourish, and whoever waits for it waits for nothing', async () =>
    {
        const { stage, elapse } = rig(true);
        const animate = vi.spyOn(Element.prototype, 'animate');
        const run = stage.animate(document.createElement('div'), [{ scale: '1.12 0.88' }, { scale: '1 1' }], { duration: 120, quiet: 'skip' });
        let done = false;

        void run.done.then(() =>
        {
            done = true;
        });

        expect(animate).not.toHaveBeenCalled();
        expect(run.length).toBe(0);

        await elapse(5);
        expect(done).toBe(true);
    });

    it('still fires every timer when it was due, so no sound and no buzz is lost', async () =>
    {
        const { stage, clock, elapse } = rig(true);
        const { seen, mark } = timed(clock);

        stage.after(120, () => mark('step'));
        stage.after(300, () => mark('land'));
        await elapse(300);

        expect(seen).toEqual([['step', 120], ['land', 300]]);
    });
});

describe('the director', () =>
{
    it('plays scenes one after another, each starting only when the one before it has finished', async () =>
    {
        const { stage, clock, elapse } = rig();
        const director = createDirector(stage, clock);
        const seen: string[] = [];

        director.enqueue(async (ctx) =>
        {
            seen.push('one starts');
            await ctx.stage.wait(300);
            seen.push('one ends');
        });
        director.enqueue(async (ctx) =>
        {
            seen.push('two starts');
            await ctx.stage.wait(100);
            seen.push('two ends');
        });

        expect(seen).toEqual(['one starts']);

        await elapse(295);
        expect(seen).toEqual(['one starts']);

        await elapse(5);
        expect(seen).toEqual(['one starts', 'one ends', 'two starts']);

        await elapse(100);
        expect(seen).toEqual(['one starts', 'one ends', 'two starts', 'two ends']);
        expect(director.busy()).toBe(false);
    });

    it('starts a scene in the turn it is queued when nothing is playing', () =>
    {
        const { stage, clock } = rig();
        const director = createDirector(stage, clock);
        let started = false;

        director.enqueue(() =>
        {
            started = true;
        });

        expect(started).toBe(true);
    });

    it('stops the scene that is playing and drops the ones behind it when it is cancelled, and leaves nothing on the clock', async () =>
    {
        const { stage, clock, elapse } = rig();
        const director = createDirector(stage, clock);
        const seen: string[] = [];

        director.enqueue(async (ctx) =>
        {
            await ctx.stage.wait(500);
            seen.push('late');
        }, { estimate: 500 });
        director.enqueue(() =>
        {
            seen.push('never');
        });

        director.cancel();

        expect(clock.pending()).toBe(0);

        await elapse(2000);

        expect(seen).toEqual([]);
        expect(director.busy()).toBe(false);
    });

    it('plays a scene queued after a cancel as if nothing had happened', async () =>
    {
        const { stage, clock, elapse } = rig();
        const director = createDirector(stage, clock);
        const seen: string[] = [];

        director.enqueue(async (ctx) =>
        {
            await ctx.stage.wait(500);
            seen.push('old');
        });
        director.cancel();
        director.enqueue(async (ctx) =>
        {
            await ctx.stage.wait(50);
            seen.push('new');
        });

        await elapse(50);

        expect(seen).toEqual(['new']);
    });

    it('is told when the queue is empty, and knows how far behind it is', async () =>
    {
        const { stage, clock, elapse } = rig();
        const director = createDirector(stage, clock);
        let idle = false;

        director.enqueue(async (ctx) => await ctx.stage.wait(400), { estimate: 400 });
        director.enqueue(async (ctx) => await ctx.stage.wait(600), { estimate: 600 });
        void director.idle().then(() =>
        {
            idle = true;
        });

        expect(director.backlog()).toBe(1000);

        await elapse(100);
        expect(director.backlog()).toBe(900);

        await elapse(300);
        expect(idle).toBe(false);

        await elapse(600);
        expect(idle).toBe(true);
        expect(director.backlog()).toBe(0);
    });

    it('tells whoever watches when it starts and when it has nothing left', async () =>
    {
        const { stage, clock, elapse } = rig();
        const director = createDirector(stage, clock);
        const told: boolean[] = [];
        const stop = director.watch((busy) => told.push(busy));

        director.enqueue(async (ctx) => await ctx.stage.wait(100));
        director.enqueue(async (ctx) => await ctx.stage.wait(100));
        expect(told).toEqual([true]);

        await elapse(200);
        expect(told).toEqual([true, false]);

        director.enqueue(async (ctx) => await ctx.stage.wait(100));
        director.cancel();
        expect(told).toEqual([true, false, true, false]);

        stop();
        director.enqueue(() => undefined);
        expect(told).toHaveLength(4);
    });

    it('plays a scene marked fast at double speed, and the next one at its own', async () =>
    {
        const { stage, clock, elapse } = rig();
        const director = createDirector(stage, clock);
        const { seen, mark } = timed(clock);

        director.enqueue(async (ctx) =>
        {
            await ctx.stage.wait(400);
            mark('fast');
        }, { fast: true });
        director.enqueue(async (ctx) =>
        {
            await ctx.stage.wait(400);
            mark('slow');
        });

        await elapse(700);

        expect(seen).toEqual([['fast', 400 / FAST], ['slow', 400 / FAST + 400]]);
    });

    it('answers a press at full pace when nothing is playing, and leaves no haste behind', async () =>
    {
        const { stage, clock, elapse } = rig();
        const director = createDirector(stage, clock);
        const { seen, mark } = timed(clock);

        director.enqueue(async (ctx) =>
        {
            await ctx.stage.wait(400);
            mark('pressed');
        }, { urgent: true });

        await elapse(400);

        director.enqueue(async (ctx) =>
        {
            await ctx.stage.wait(400);
            mark('after');
        });

        await elapse(400);

        expect(seen).toEqual([['pressed', 400], ['after', 800]]);
    });

    it('hastens what is in front of a press, and plays what was pressed at its own pace', async () =>
    {
        const { stage, clock, elapse } = rig();
        const director = createDirector(stage, clock);
        const { seen, mark } = timed(clock);

        director.enqueue(async (ctx) =>
        {
            await ctx.stage.wait(2000);
            mark('playing');
        });
        director.enqueue(async (ctx) =>
        {
            await ctx.stage.wait(2000);
            mark('waiting');
        });

        await elapse(200);

        director.enqueue(async (ctx) =>
        {
            await ctx.stage.wait(400);
            mark('pressed');
        }, { urgent: true });

        await elapse(1600);

        expect(seen).toEqual([
            ['playing', 200 + 1800 / HASTE],
            ['waiting', 200 + 1800 / HASTE + 2000 / HASTE],
            ['pressed', 200 + 1800 / HASTE + 2000 / HASTE + 400]
        ]);

        director.enqueue(async (ctx) =>
        {
            await ctx.stage.wait(400);
            mark('later');
        });

        await elapse(400);

        expect(seen[3][1] - seen[2][1]).toBeGreaterThanOrEqual(400);
    });

    it('keeps the cues of a hastened scene apart and in order, none of them in the tick of the press', async () =>
    {
        const { stage, clock, elapse } = rig();
        const director = createDirector(stage, clock);
        const { seen, mark } = timed(clock);

        director.enqueue(async (ctx) =>
        {
            ctx.stage.after(100, () => mark('step'));
            ctx.stage.after(300, () => mark('land'));
            await ctx.stage.wait(500);
            mark('done');
        });

        await elapse(50);
        director.enqueue(() => mark('pressed'), { urgent: true });

        expect(seen).toEqual([]);

        await elapse(200);

        expect(seen.map(([name]) => name)).toEqual(['step', 'land', 'done', 'pressed']);
        expect(seen[0][1]).toBeGreaterThan(50);
        expect(seen[1][1]).toBeGreaterThan(seen[0][1]);
        expect(seen[2][1]).toBeGreaterThan(seen[1][1]);
    });

    it('survives a scene that throws, tells whoever asked, and plays the next one', async () =>
    {
        const { stage, clock, elapse } = rig();
        const failed = vi.fn();
        const director = createDirector(stage, clock, failed);
        const seen: string[] = [];

        director.enqueue(() =>
        {
            throw new Error('broken scene');
        });
        director.enqueue(() =>
        {
            seen.push('next');
        });

        await elapse(0);

        expect(failed).toHaveBeenCalledTimes(1);
        expect(seen).toEqual(['next']);
        expect(director.busy()).toBe(false);
    });

    it('is not stopped by a complaint that itself fails', async () =>
    {
        const { stage, clock, elapse } = rig();
        const director = createDirector(stage, clock, () =>
        {
            throw new Error('the handler broke too');
        });
        const seen: string[] = [];

        director.enqueue(() =>
        {
            throw new Error('broken scene');
        });
        director.enqueue(() =>
        {
            seen.push('next');
        });

        await elapse(0);

        expect(seen).toEqual(['next']);
        expect(director.busy()).toBe(false);
    });

    it('gives up on a scene that never ends, says so, and is ready for the next', async () =>
    {
        const { stage, clock, elapse } = rig();
        const failed = vi.fn();
        const director = createDirector(stage, clock, failed);
        const seen: string[] = [];

        director.enqueue(async () => await new Promise<void>(() => undefined), { estimate: 100 });

        await elapse(100 * OVERRUN + OVERRUN_GRACE - 5);
        expect(failed).not.toHaveBeenCalled();
        expect(director.busy()).toBe(true);

        await elapse(5);
        expect(failed).toHaveBeenCalledTimes(1);
        expect(director.busy()).toBe(false);

        director.enqueue(() =>
        {
            seen.push('next');
        });

        expect(seen).toEqual(['next']);
    });
});

describe('a hold on the felt', () =>
{
    const held = (cue: { fast?: boolean } = {}, ms = 900, least = 450) =>
    {
        const { stage, clock, elapse } = rig();
        const director = createDirector(stage, clock);
        const { seen, mark } = timed(clock);

        director.enqueue(async (ctx) =>
        {
            await ctx.linger(ms, least);
            mark('held');
        }, { ...cue, estimate: 1000 });

        return { director, elapse, seen, mark };
    };

    it('lasts its whole length when nothing is waiting behind it', async () =>
    {
        const { elapse, seen } = held();

        await elapse(900);

        expect(seen).toEqual([['held', 900]]);
    });

    it('ends at its least when something that may cut it arrives before then', async () =>
    {
        const { director, elapse, seen } = held();

        await elapse(200);
        director.enqueue(() => undefined, { cuts: true });
        await elapse(700);

        expect(seen).toEqual([['held', 450]]);
    });

    it('ends at once when something that may cut it arrives after its least', async () =>
    {
        const { director, elapse, seen } = held();

        await elapse(600);
        director.enqueue(() => undefined, { cuts: true });
        await elapse(0);

        expect(seen).toEqual([['held', 600]]);
    });

    it('is not cut by something that may not cut it', async () =>
    {
        const { director, elapse, seen } = held();

        await elapse(200);
        director.enqueue(() => undefined);
        await elapse(700);

        expect(seen).toEqual([['held', 900]]);
    });

    it('is held only to its least when what may cut it was already waiting', async () =>
    {
        const { stage, clock, elapse } = rig();
        const director = createDirector(stage, clock);
        const { seen, mark } = timed(clock);

        director.enqueue(async (ctx) =>
        {
            await ctx.stage.wait(100);
            await ctx.linger(900, 450);
            mark('held');
        });
        director.enqueue(() => undefined, { cuts: true });

        await elapse(600);

        expect(seen).toEqual([['held', 550]]);
    });

    it('is taken to its least by a press', async () =>
    {
        const { director, elapse, seen, mark } = held();

        await elapse(100);
        director.enqueue(() => mark('pressed'), { urgent: true });
        await elapse(400);

        expect(seen).toEqual([['held', 450], ['pressed', 450]]);
    });

    it('is halved at double speed, and never shorter than the floor', async () =>
    {
        const whole = held({ fast: true });

        await whole.elapse(900);
        expect(whole.seen).toEqual([['held', 900 / FAST]]);

        const cut = held({ fast: true });

        cut.director.enqueue(() => undefined, { cuts: true });
        await cut.elapse(900);
        expect(cut.seen).toEqual([['held', LINGER_FLOOR]]);

        const short = held({ fast: true }, 400, 200);

        short.director.enqueue(() => undefined, { cuts: true });
        await short.elapse(900);
        expect(short.seen).toEqual([['held', 200]]);
    });

    it('counts for no more than its least when the next thing asks how far behind the table is', async () =>
    {
        const { stage, clock, elapse } = rig();
        const director = createDirector(stage, clock);

        director.enqueue(async (ctx) =>
        {
            await ctx.linger(2000, 400);
            await ctx.stage.wait(600);
        }, { estimate: 1000 });

        await elapse(200);
        expect(director.backlog()).toBe(800);

        await elapse(1300);
        expect(director.backlog()).toBe(600);

        await elapse(500);
        expect(director.backlog()).toBe(600);

        await elapse(300);
        expect(director.backlog()).toBe(300);
    });
});

describe('the feed', () =>
{
    const event = (rev: number, seat = 0, kind = 'hokm', moves: unknown[] = [{ e: 'card' }]) => ({ rev, seat, log: { kind, moves } });

    it('hands over what happened after the board in hand, action by action, with who acted', () =>
    {
        const told = actsOf<{ e: string }>([event(3), event(4, 1), event(5, 0, 'hokm', [{ e: 'a' }, { e: 'b' }])], 'hokm', 3, 5);

        expect(told.whole).toBe(true);
        expect(told.acts).toEqual([
            { rev: 4, seat: 1, moves: [{ e: 'card' }] },
            { rev: 5, seat: 0, moves: [{ e: 'a' }, { e: 'b' }] }
        ]);
    });

    it('leaves out a move the board in hand has not reached', () =>
    {
        expect(actsOf([event(4), event(5)], 'hokm', 3, 4).acts.map((act) => act.rev)).toEqual([4]);
    });

    it('says so when a revision is missing, at the front or in the middle', () =>
    {
        expect(actsOf([event(5)], 'hokm', 3, 5).whole).toBe(false);
        expect(actsOf([event(4), event(6)], 'hokm', 3, 6).whole).toBe(false);
    });

    it('ignores another game\'s events, and has nothing to say of nothing', () =>
    {
        expect(actsOf([event(4, 0, 'poker')], 'hokm', 3, 4)).toEqual({ acts: [], whole: true });
    });
});

describe('the run of events a store hands on', () =>
{
    const told = (...revs: number[]) => revs.map((rev) => ({ rev }));

    it('is what came after the revision in hand and no later than the board', () =>
    {
        expect(runOf(told(2, 3, 4, 5, 6), 3, 5)).toEqual({ fresh: told(4, 5), gap: false, whole: true });
    });

    it('has a gap when it does not start where the revision in hand left off, and none when nothing is in hand', () =>
    {
        expect(runOf(told(5, 6), 3, 6)).toMatchObject({ gap: true, whole: false });
        expect(runOf(told(5, 6), -1, 6)).toMatchObject({ gap: false, whole: false });
    });

    it('is whole only when it reaches the board, one revision after another', () =>
    {
        expect(runOf(told(4, 5), 3, 6), 'it stops short of the board').toMatchObject({ gap: false, whole: false });
        expect(runOf(told(4, 6), 3, 6), 'a hole in the middle').toMatchObject({ gap: false, whole: false });
        expect(runOf(told(4, 4, 5), 3, 5), 'a revision twice').toMatchObject({ whole: false });
        expect(runOf(told(), 3, 3), 'nothing new').toEqual({ fresh: [], gap: false, whole: true });
        expect(runOf(told(), 3, 5), 'a board that moved with nothing said').toEqual({ fresh: [], gap: false, whole: false });
    });
});

describe('the layers of a table', () =>
{
    it('puts a moving piece above every resting one, and the dice above both', () =>
    {
        expect(LAYER.piece + 9).toBeLessThan(LAYER.count);
        expect(LAYER.count).toBeLessThan(LAYER.mark);
        expect(LAYER.mark).toBeLessThan(LAYER.cube);
        expect(LAYER.cube).toBeLessThan(LAYER.moving);
        expect(LAYER.moving).toBeLessThan(LAYER.airborne);
        expect(LAYER.airborne).toBeLessThan(LAYER.dice);
        expect(LAYER.dice).toBeLessThan(LAYER.burst);
        expect(LAYER.burst).toBeLessThan(LAYER.banner);
    });

    it('hands the same numbers to the stylesheet', () =>
    {
        const host = document.createElement('div');

        layered(host);

        for (const [name, value] of Object.entries(LAYER))
        {
            expect(host.style.getPropertyValue(`--layer-${ name }`), name).toBe(String(value));
        }
    });
});

describe('a route across the table', () =>
{
    const route = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 200, y: 50 }, { x: 300, y: 50 }];

    it('lands on every point of a walk, on the ground, when it says it will', () =>
    {
        const walked = walk(route, { hops: [100, 80, 120], lifts: [0.2, 0.2, 0.2] });

        expect(walked.length).toBe(300);
        expect(walked.lands).toEqual([100, 180, 300]);

        for (const [leg, at] of walked.lands.entries())
        {
            const step = walked.steps.find((one) => Math.abs(one.at - at) < 0.001);

            expect(step, `landing ${ leg }`).toMatchObject({ x: route[leg + 1].x, y: route[leg + 1].y, lift: 0 });
        }

        expect(walked.steps[0]).toMatchObject({ at: 0, x: 0, y: 0, lift: 0 });
    });

    it('moves forward in time all the way, and leaves the ground between two points', () =>
    {
        const walked = walk(route, { hops: [100, 80, 120], lifts: [0.2, 0.2, 0.2] });

        for (let index = 1; index < walked.steps.length; index += 1)
        {
            expect(walked.steps[index].at).toBeGreaterThan(walked.steps[index - 1].at);
        }

        expect(Math.max(...walked.steps.map((one) => one.lift))).toBeGreaterThan(0.15);
        expect(Math.max(...walked.steps.map((one) => one.lift))).toBeLessThanOrEqual(0.2);
        expect(walked.steps[walked.steps.length - 1].progress).toBe(1);
    });

    it('carries something in one arc from where it was to where it goes', () =>
    {
        const steps = arc({ x: 10, y: 20 }, { x: 110, y: 220 }, { duration: 400, arch: 0.5 });
        const last = steps[steps.length - 1];

        expect(steps[0]).toMatchObject({ at: 0, x: 10, y: 20, lift: 0 });
        expect(last.at).toBe(400);
        expect(last.x).toBeCloseTo(110);
        expect(last.y).toBeCloseTo(220);
        expect(last.lift).toBeCloseTo(0);
        expect(Math.max(...steps.map((one) => one.lift))).toBeCloseTo(0.5, 1);
    });
});
