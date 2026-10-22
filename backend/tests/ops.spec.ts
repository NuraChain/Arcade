import { afterEach, describe, expect, it } from 'vitest';

import { createOps, FAILURES_KEPT, LOOP_TICK_MS, MINUTE_MS } from '../src/http/ops.ts';

const START = Date.parse('2026-10-22T10:00:00.000Z');

let heard: string[] = [];
let stops: (() => void)[] = [];

const inner = {
    onComplete: (request: Request, response: Response, durationMs: number) =>
    {
        heard.push(`${ request.method } ${ new URL(request.url).pathname } ${ response.status } ${ durationMs }`);
    }
};

const asked = (method: string, path: string) => new Request(`http://local${ path }`, { method });

const answered = (status: number) => new Response(null, { status });

const opened = (clock: { at: number }) =>
{
    const ops = createOps(() => clock.at);

    stops.push(() => ops.stop());

    return ops;
};

afterEach(() =>
{
    for (const stop of stops)
    {
        stop();
    }

    stops = [];
    heard = [];
});

describe('what this server knows of itself', () =>
{
    it('counts the requests of the last hour and the ones that failed, and hands every request on to the log as it came', () =>
    {
        const clock = { at: START };
        const ops = opened(clock);
        const observer = ops.observer(inner);

        observer.onComplete(asked('GET', '/api/tables/mine'), answered(200), 3);
        observer.onComplete(asked('POST', '/api/tables/t1/start?again=1'), answered(500), 9);
        clock.at += 30 * MINUTE_MS;
        observer.onComplete(asked('GET', '/api/healthz'), answered(503), 1);
        observer.onComplete(asked('GET', '/api/chat'), answered(404), 2);

        expect(heard).toEqual(['GET /api/tables/mine 200 3', 'POST /api/tables/t1/start 500 9', 'GET /api/healthz 503 1', 'GET /api/chat 404 2']);
        expect([ops.health().requests, ops.health().failed]).toEqual([4, 2]);
        expect(ops.health().failures).toEqual([
            { at: '2026-10-22T10:30:00.000Z', method: 'GET', path: '/api/healthz', status: 503 },
            { at: '2026-10-22T10:00:00.000Z', method: 'POST', path: '/api/tables/t1/start', status: 500 }
        ]);

        clock.at += 31 * MINUTE_MS;

        expect([ops.health().requests, ops.health().failed], 'the first two are over an hour old').toEqual([2, 1]);
        expect(ops.health().failures).toHaveLength(2);
    });

    it('counts a minute afresh when the same minute of the next hour comes round', () =>
    {
        const clock = { at: START };
        const ops = opened(clock);
        const observer = ops.observer(inner);

        observer.onComplete(asked('GET', '/api/a'), answered(500), 1);
        observer.onComplete(asked('GET', '/api/b'), answered(200), 1);
        clock.at += 60 * MINUTE_MS;
        observer.onComplete(asked('GET', '/api/c'), answered(200), 1);

        expect([ops.health().requests, ops.health().failed]).toEqual([1, 0]);
    });

    it('keeps the last fifty failures, newest first, each without its query', () =>
    {
        const ops = opened({ at: START });
        const observer = ops.observer(inner);

        for (let at = 0; at < FAILURES_KEPT + 5; at += 1)
        {
            observer.onComplete(asked('GET', `/api/x/${ at }?q=private-${ at }`), answered(500), 1);
        }

        const failures = ops.health().failures;

        expect(failures).toHaveLength(FAILURES_KEPT);
        expect([failures[0].path, failures.at(-1)?.path]).toEqual([`/api/x/${ FAILURES_KEPT + 4 }`, '/api/x/5']);
        expect(failures.some((one) => one.path.includes('private'))).toBe(false);
    });

    it('hands out a copy of its failures, so a reader cannot change what it keeps', () =>
    {
        const ops = opened({ at: START });

        ops.observer(inner).onComplete(asked('GET', '/api/x'), answered(500), 1);
        ops.health().failures[0].path = '/elsewhere';

        expect(ops.health().failures[0].path).toBe('/api/x');
    });

    it('says how long it has run and what it holds', () =>
    {
        const health = opened({ at: START }).health();

        expect(Number.isInteger(health.uptime) && health.uptime >= 0).toBe(true);
        expect([health.rss > 0, health.heap > 0]).toEqual([true, true]);
    });

    it('says how much of the time its event loop was busy, and the longest it waited past its own tick', async () =>
    {
        const ops = opened({ at: START });

        await new Promise((resolve) => setTimeout(resolve, 3 * LOOP_TICK_MS));

        const until = Date.now() + 150;

        while (Date.now() < until)
        {
            Math.sqrt(Date.now());
        }

        await new Promise((resolve) => setTimeout(resolve, 3 * LOOP_TICK_MS));

        const loop = ops.health().loop;

        expect(loop.busy).toBeGreaterThan(0.3);
        expect(loop.busy).toBeLessThanOrEqual(1);
        expect(loop.stall).toBeGreaterThan(80);
    });
});
