import type { Clock } from '../motion.ts';
import type { Stage } from './stage.ts';

export interface Ctx
{
    readonly stage: Stage;
    live(): boolean;
    linger(ms: number, least: number): Promise<void>;
}

export type Scene = (ctx: Ctx) => Promise<void> | void;

export interface Cue
{
    estimate?: number;
    fast?: boolean;
    urgent?: boolean;
    cuts?: boolean;
}

export interface Director
{
    enqueue(scene: Scene, cue?: Cue): void;
    cancel(): void;
    busy(): boolean;
    backlog(): number;
    idle(): Promise<void>;
    watch(listener: (busy: boolean) => void): () => void;
}

interface Hold
{
    started: number;
    short: number;
    cut(): void;
    drop(): void;
}

interface Entry
{
    scene: Scene;
    estimate: number;
    fast: boolean;
    cuts: boolean;
    rushed: boolean;
    played: number;
    since: number;
    rate: number;
    hold: Hold | null;
    watchdog: () => void;
}

export const FAST = 2;

export const HASTE = 4;

export const LINGER_FLOOR = 300;

export const OVERRUN = 3;

export const OVERRUN_GRACE = 4000;

export function createDirector(stage: Stage, clock: Clock, onError: (error: unknown) => void = () => undefined): Director
{
    const listeners = new Set<(busy: boolean) => void>();
    let queue: Entry[] = [];
    let running: Entry | null = null;
    let generation = 0;
    let waiting: (() => void)[] = [];

    const report = (error: unknown) =>
    {
        try
        {
            onError(error);
        }
        catch
        {
            return;
        }
    };

    const tell = (busy: boolean) =>
    {
        for (const listener of [...listeners])
        {
            try
            {
                listener(busy);
            }
            catch (error)
            {
                report(error);
            }
        }
    };

    const drain = () =>
    {
        const resolvers = waiting;

        waiting = [];

        for (const resolve of resolvers)
        {
            resolve();
        }
    };

    const rateOf = (entry: Entry) => (entry.rushed ? HASTE : (entry.fast ? FAST : 1));

    const playedOf = (entry: Entry) =>
    {
        const now = clock.now();

        return entry.hold === null
            ? entry.played + (now - entry.since) * entry.rate
            : entry.played + Math.min(now - entry.hold.started, entry.hold.short);
    };

    const retime = (entry: Entry) =>
    {
        if (entry.hold === null)
        {
            entry.played = playedOf(entry);
            entry.since = clock.now();
        }

        entry.rate = rateOf(entry);
        stage.pace(entry.rate);
    };

    const stop = () =>
    {
        const was = running !== null || queue.length > 0;

        generation += 1;
        running?.watchdog();
        running?.hold?.drop();
        queue = [];
        running = null;
        stage.clear();
        stage.pace(1);
        drain();

        if (was)
        {
            tell(false);
        }
    };

    const overrun = (entry: Entry) =>
    {
        if (running !== entry)
        {
            return;
        }

        report(new Error('A scene on the table did not end.'));

        if (running === entry)
        {
            stop();
        }
    };

    const linger = (entry: Entry, round: number, ms: number, least: number) => new Promise<void>((resolve) =>
    {
        if (round !== generation)
        {
            return;
        }

        const scaled = (span: number) => (entry.fast ? Math.max(Math.min(span, LINGER_FLOOR), span / FAST) : span);
        const full = scaled(Math.max(ms, least));
        const short = scaled(Math.min(ms, least));
        const started = clock.now();
        let cancel: () => void = () => undefined;

        entry.played = playedOf(entry);

        const end = () =>
        {
            cancel();
            entry.played += Math.min(clock.now() - started, short);
            entry.since = clock.now();
            entry.hold = null;
            resolve();
        };

        const until = (span: number) =>
        {
            const left = started + span - clock.now();

            cancel();

            if (left <= 0)
            {
                end();

                return;
            }

            cancel = clock.after(left, end);
        };

        entry.hold = { started, short, cut: () => until(short), drop: () => cancel() };
        until(entry.rushed || queue.some((next) => next.cuts) ? short : full);
    });

    const pump = async () =>
    {
        const round = generation;

        while (queue.length > 0 && round === generation)
        {
            const entry = queue.shift() as Entry;

            running = entry;
            entry.since = clock.now();
            entry.rate = rateOf(entry);
            stage.pace(entry.rate);
            entry.watchdog = clock.after(entry.estimate * OVERRUN + OVERRUN_GRACE, () => overrun(entry));

            try
            {
                await entry.scene({
                    stage,
                    live: () => round === generation,
                    linger: (ms, least) => linger(entry, round, ms, least)
                });
            }
            catch (error)
            {
                if (round === generation)
                {
                    report(error);
                }
            }

            entry.watchdog();
        }

        if (round === generation)
        {
            running = null;
            stage.pace(1);
            drain();
            tell(false);
        }
    };

    return {
        enqueue(scene, cue = {})
        {
            const entry: Entry = {
                scene,
                estimate: cue.estimate ?? 0,
                fast: cue.fast === true,
                cuts: cue.cuts === true,
                rushed: false,
                played: 0,
                since: 0,
                rate: 1,
                hold: null,
                watchdog: () => undefined
            };

            if (cue.urgent === true && running !== null)
            {
                for (const ahead of queue)
                {
                    ahead.rushed = true;
                }

                if (!running.rushed)
                {
                    running.rushed = true;
                    retime(running);
                }

                running.hold?.cut();
            }
            else if (entry.cuts)
            {
                running?.hold?.cut();
            }

            queue.push(entry);

            if (running === null)
            {
                tell(true);
                void pump();
            }
        },

        cancel: stop,

        busy: () => running !== null || queue.length > 0,

        backlog()
        {
            const left = running === null ? 0 : Math.max(0, running.estimate - playedOf(running));

            return queue.reduce((sum, entry) => sum + entry.estimate, left);
        },

        idle()
        {
            if (running === null && queue.length === 0)
            {
                return Promise.resolve();
            }

            return new Promise<void>((resolve) =>
            {
                waiting.push(resolve);
            });
        },

        watch(listener)
        {
            listeners.add(listener);

            return () =>
            {
                listeners.delete(listener);
            };
        }
    };
}
