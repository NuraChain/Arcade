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
}

export interface Presenter<M>
{
    see(batch: Batch): void;
    act(scene: Scene, estimate?: number): void;
    predict(prediction: Prediction<M> | null): void;
    presenting(): boolean;
    watch(listener: (presenting: boolean) => void): () => void;
    dispose(): void;
}

export const FAST_OVER = 1500;

export const LIVE_OVER = 2;

export const SETTLE = 400;

const hidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';

export function createPresenter<V, M>(options: PresenterOptions<V, M>): Presenter<M>
{
    const { table } = options;
    let matchId: string | null = null;
    let heard = -1;
    let cursor = -1;
    let prediction: Prediction<M> | null = null;

    const snap = (sight: Sight<V> | null) =>
    {
        director.cancel();

        if (sight !== null)
        {
            table.reset(sight);
        }
    };

    const director = createDirector(options.stage, options.clock, (error) =>
    {
        options.report(error);
        snap(options.sight());
    });

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

        if (!fresh.whole || hidden())
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

        const estimate = table.estimate(acts);
        const waiting = director.backlog();

        if (batch.live ? waiting > table.history * LIVE_OVER : waiting + estimate > table.history)
        {
            snap(sight);

            return true;
        }

        director.enqueue((ctx) => table.play(acts, sight, ctx), {
            estimate,
            fast: waiting + table.estimate(acts.slice(0, -1)) > FAST_OVER,
            cuts: true
        });

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

    const away = () =>
    {
        if (hidden() && matchId !== null)
        {
            snap(options.sight());
        }
    };

    if (typeof document !== 'undefined')
    {
        document.addEventListener('visibilitychange', away);
    }

    return {
        see(batch)
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

            if (unheard && batch.id === sight.id && told(sight, batch))
            {
                return;
            }

            if (sight.rev > cursor)
            {
                moved(sight);
            }
        },

        act(scene, estimate = 0)
        {
            director.enqueue(scene, { estimate, urgent: true, cuts: true });
        },

        predict(next)
        {
            prediction = next;
        },

        presenting: () => director.busy(),

        watch: (listener) => director.watch(listener),

        dispose()
        {
            if (typeof document !== 'undefined')
            {
                document.removeEventListener('visibilitychange', away);
            }

            director.cancel();
        }
    };
}
