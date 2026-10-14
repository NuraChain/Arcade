import type { Clock } from '../motion.ts';
import { createDirector, type Ctx, type Scene } from './director.ts';
import { actsOf, type Act, type Batch } from './feed.ts';
import type { Stage } from './stage.ts';

export interface Sight<V>
{
    id: string;
    rev: number;
    seat: number | null;
    view: V;
}

export interface Table<V, M>
{
    readonly kind: string;
    readonly history: number;
    before?(sight: Sight<V>): Sight<V>;
    reset(sight: Sight<V>): void;
    same(sight: Sight<V>): boolean;
    settle(sight: Sight<V>, ctx: Ctx): Promise<void> | void;
    play(acts: readonly Act<M>[], sight: Sight<V>, ctx: Ctx): Promise<void> | void;
    estimate(acts: readonly Act<M>[]): number;
}

export interface Prediction<M>
{
    rev: number;
    covers(moves: readonly M[]): number | null;
}

export interface PresenterOptions<V, M>
{
    stage: Stage;
    clock: Clock;
    table: Table<V, M>;
    sight: () => Sight<V> | null;
    report: (error: unknown) => void;
    lead?: () => number;
    due?: () => number | null;
}

export interface Presenter<M>
{
    see(batch: Batch): void;
    act(scene: Scene, estimate?: number): void;
    predict(prediction: Prediction<M> | null): void;
    frame(box: Element | null): void;
    presenting(): boolean;
    watch(listener: (presenting: boolean) => void): () => void;
    dispose(): void;
}

interface Missed<V, M>
{
    acts: readonly Act<M>[];
    sight: Sight<V>;
}

export const FAST_OVER = 1500;

export const LIVE_OVER = 2;

export const SETTLE = 400;

export const BOX_SLACK = 1;

const hidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';

export function createPresenter<V, M>(options: PresenterOptions<V, M>): Presenter<M>
{
    const { table } = options;
    const listeners = new Set<(presenting: boolean) => void>();
    let matchId: string | null = null;
    let heard = -1;
    let cursor = -1;
    let prediction: Prediction<M> | null = null;
    let missed: Missed<V, M>[] = [];
    let said = false;

    const behind = () => director.busy() || missed.length > 0;

    const say = () =>
    {
        const now = behind();

        if (now === said)
        {
            return;
        }

        said = now;

        for (const listener of [...listeners])
        {
            try
            {
                listener(now);
            }
            catch (error)
            {
                options.report(error);
            }
        }
    };

    const snap = (sight: Sight<V> | null) =>
    {
        missed = [];
        director.cancel();

        if (sight !== null)
        {
            table.reset(sight);
        }

        say();
    };

    const director = createDirector(options.stage, options.clock, (error) =>
    {
        options.report(error);
        snap(options.sight());
    });

    const play = (acts: readonly Act<M>[], sight: Sight<V>, estimate: number, waiting: number) =>
    {
        director.enqueue((ctx) => table.play(acts, sight, ctx), {
            estimate,
            fast: waiting + table.estimate(acts.slice(0, -1)) > FAST_OVER,
            cuts: true
        });
    };

    const keep = (acts: readonly Act<M>[], sight: Sight<V>) =>
    {
        let from: Sight<V> | null = null;

        missed.push({ acts, sight });

        while (missed.length > 0 && table.estimate(missed.flatMap((one) => one.acts)) > table.history)
        {
            from = (missed.shift() as Missed<V, M>).sight;
        }

        if (from !== null)
        {
            director.cancel();
            table.reset(from);
        }

        say();
    };

    const told = (sight: Sight<V>, batch: Batch) =>
    {
        if (batch.jump)
        {
            cursor = sight.rev;
            prediction = null;
            snap(sight);

            return true;
        }

        const fresh = actsOf<M>(batch.events, table.kind, cursor, sight.rev);

        if (fresh.acts.length === 0)
        {
            return false;
        }

        const guess = prediction;
        let acts = fresh.acts;

        cursor = sight.rev;
        prediction = null;

        if (!fresh.whole || (guess !== null && hidden()))
        {
            snap(sight);

            return true;
        }

        if (guess !== null)
        {
            const first = acts[0];
            const covered = first.rev === guess.rev + 1 && first.seat === sight.seat ? guess.covers(first.moves) : null;

            if (covered === null)
            {
                snap(sight);

                return true;
            }

            acts = [{ ...first, moves: first.moves.slice(covered) }, ...acts.slice(1)];
        }

        if (hidden())
        {
            keep(acts, sight);

            return true;
        }

        const estimate = table.estimate(acts);
        const waiting = director.backlog();

        if (batch.live ? waiting > table.history * LIVE_OVER : waiting + estimate > table.history)
        {
            snap(sight);

            return true;
        }

        play(acts, sight, estimate, waiting);

        return true;
    };

    const opened = (sight: Sight<V>, batch: Batch) =>
    {
        const fresh = actsOf<M>(batch.events, table.kind, 0, sight.rev);
        const last = fresh.acts[fresh.acts.length - 1];

        if (table.before === undefined || hidden() || last === undefined || !fresh.whole || last.rev !== sight.rev)
        {
            return false;
        }

        cursor = 0;
        snap(table.before(sight));

        const wait = options.lead?.() ?? 0;

        if (wait > 0)
        {
            director.enqueue((ctx) => ctx.stage.wait(wait), { estimate: wait });
        }

        return told(sight, batch);
    };

    const moved = (sight: Sight<V>) =>
    {
        cursor = sight.rev;

        if (prediction !== null && prediction.rev < sight.rev)
        {
            prediction = null;
        }

        if (hidden())
        {
            snap(sight);

            return;
        }

        if (director.busy() || !table.same(sight))
        {
            director.enqueue((ctx) => table.settle(sight, ctx), { estimate: SETTLE, cuts: true });
        }
    };

    let late: (() => void) | null = null;

    const bound = () =>
    {
        const most = director.busy() ? (options.due?.() ?? null) : null;

        if (most === null)
        {
            late?.();
            late = null;
        }
        else
        {
            late ??= options.clock.after(most, () => director.enqueue(() => undefined, { urgent: true }));
        }
    };

    const release = () =>
    {
        if (missed.length === 0 || hidden())
        {
            return;
        }

        const acts = missed.flatMap((one) => one.acts);
        const { sight } = missed[missed.length - 1];
        const waiting = director.backlog();

        missed = [];
        play(acts, sight, table.estimate(acts), waiting);
        say();
        bound();
    };

    const turned = () =>
    {
        if (!hidden())
        {
            release();

            return;
        }

        if (matchId !== null)
        {
            snap(options.sight());
        }
    };

    if (typeof document !== 'undefined')
    {
        document.addEventListener('visibilitychange', turned);
    }

    const take = (batch: Batch) =>
    {
        const sight = options.sight();

        if (sight === null)
        {
            return;
        }

        const first = batch.id === sight.id && batch.opens !== undefined && batch.opens();

        if (sight.id !== matchId)
        {
            matchId = sight.id;
            heard = batch.seq;
            prediction = null;

            if (first && opened(sight, batch))
            {
                return;
            }

            cursor = sight.rev;
            snap(sight);

            return;
        }

        const unheard = batch.seq > heard;

        heard = Math.max(heard, batch.seq);
        release();

        if (unheard && batch.id === sight.id && told(sight, batch))
        {
            return;
        }

        if (sight.rev > cursor)
        {
            moved(sight);
        }
    };

    let boxed: ResizeObserver | null = null;
    let held: readonly [number, number] | null = null;

    const reboxed = (width: number, height: number) =>
    {
        const before = held;

        if (before !== null && Math.abs(before[0] - width) <= BOX_SLACK && Math.abs(before[1] - height) <= BOX_SLACK)
        {
            return;
        }

        held = [width, height];

        if (before !== null && director.busy())
        {
            options.stage.land();
        }
    };

    director.watch((busy) =>
    {
        if (!busy)
        {
            bound();
        }

        say();
    });

    return {
        see(batch)
        {
            take(batch);
            bound();
        },

        act(scene, estimate = 0)
        {
            director.enqueue(scene, { estimate, urgent: true, cuts: true });
        },

        predict(next)
        {
            prediction = next;
        },

        frame(box)
        {
            boxed?.disconnect();
            boxed = null;
            held = null;

            if (box !== null && typeof ResizeObserver !== 'undefined')
            {
                boxed = new ResizeObserver(([entry]) => reboxed(entry.contentRect.width, entry.contentRect.height));
                boxed.observe(box);
            }
        },

        presenting: behind,

        watch(listener)
        {
            listeners.add(listener);

            return () =>
            {
                listeners.delete(listener);
            };
        },

        dispose()
        {
            if (typeof document !== 'undefined')
            {
                document.removeEventListener('visibilitychange', turned);
            }

            boxed?.disconnect();
            boxed = null;
            missed = [];
            director.cancel();
            say();
        }
    };
}
