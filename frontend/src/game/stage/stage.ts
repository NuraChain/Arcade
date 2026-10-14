import { TIMING, type Clock } from '../motion.ts';

export type Quiet = 'in' | 'out' | 'skip';

export interface Timing
{
    duration: number;
    delay?: number;
    easing?: string;
    fill?: FillMode;
    quiet?: Quiet;
    landed?: () => void;
}

export interface Run
{
    readonly done: Promise<void>;
    readonly length: number;
    cancel(): void;
    finish(): void;
}

export interface StageOptions
{
    clock: Clock;
    quiet: () => boolean;
    report?: (error: unknown) => void;
}

export interface Stage
{
    quiet(): boolean;
    pace(rate: number): void;
    animate(element: Element, frames: Keyframe[], timing: Timing): Run;
    after(ms: number, run: () => void): () => void;
    wait(ms: number): Promise<void>;
    land(): void;
    clear(): void;
}

interface Due
{
    left: number;
    since: number;
    stop: () => void;
    fire: () => void;
}

interface Live
{
    rate(next: number): void;
    end(cancelled: boolean, abandon: boolean): void;
}

const SLOWEST = 0.05;

const fadeIn = (): Keyframe[] => [{ opacity: 0, offset: 0 }];

const fadeOut = (): Keyframe[] => [{ opacity: 0, offset: 1 }];

const tune = (animation: Animation, rate: number) =>
{
    try
    {
        animation.updatePlaybackRate(rate);
    }
    catch
    {
        animation.playbackRate = rate;
    }
};

export function createStage(options: StageOptions): Stage
{
    const lives = new Set<Live>();
    const dues = new Set<Due>();
    let rate = 1;

    const guarded = (run: () => void) =>
    {
        try
        {
            run();
        }
        catch (error)
        {
            options.report?.(error);
        }
    };

    const arm = (due: Due) =>
    {
        due.since = options.clock.now();
        due.stop = options.clock.after(due.left / rate, () =>
        {
            dues.delete(due);
            guarded(due.fire);
        });
    };

    const schedule = (ms: number, fire: () => void) =>
    {
        const due: Due = { left: Math.max(0, ms), since: 0, stop: () => undefined, fire };

        dues.add(due);
        arm(due);

        return () =>
        {
            due.stop();
            dues.delete(due);
        };
    };

    return {
        quiet: () => options.quiet(),

        pace(next)
        {
            const to = Math.max(SLOWEST, next);

            if (to === rate)
            {
                return;
            }

            const now = options.clock.now();

            for (const due of dues)
            {
                due.stop();
                due.left = Math.max(0, due.left - (now - due.since) * rate);
            }

            rate = to;

            for (const due of dues)
            {
                arm(due);
            }

            for (const live of lives)
            {
                live.rate(rate);
            }
        },

        animate(element, frames, timing)
        {
            const still = options.quiet();
            const mode = timing.quiet ?? 'in';
            const skipped = still && mode === 'skip';
            const delay = skipped ? 0 : Math.max(0, timing.delay ?? 0);
            const duration = skipped ? 0 : (still ? TIMING.FADE : Math.max(0, timing.duration));
            const shown = still ? (mode === 'out' ? fadeOut() : fadeIn()) : frames;
            let resolve: () => void = () => undefined;
            let ended = false;
            let animation: Animation | null = null;

            const done = new Promise<void>((settle) =>
            {
                resolve = settle;
            });

            if (!skipped && typeof element.animate === 'function')
            {
                try
                {
                    animation = element.animate(shown, {
                        duration,
                        delay,
                        easing: still ? 'linear' : (timing.easing ?? 'linear'),
                        fill: still && mode === 'out' ? 'both' : (timing.fill ?? 'backwards')
                    });
                    animation.finished.catch(() => undefined);

                    if (rate !== 1)
                    {
                        tune(animation, rate);
                    }
                }
                catch
                {
                    animation = null;
                }
            }

            const live: Live = {
                rate(next)
                {
                    if (animation !== null)
                    {
                        tune(animation, next);
                    }
                },

                end(cancelled, abandon)
                {
                    if (ended)
                    {
                        return;
                    }

                    ended = true;
                    stop();
                    lives.delete(live);

                    try
                    {
                        if (cancelled)
                        {
                            animation?.cancel();
                            animation = null;
                        }
                        else
                        {
                            animation?.finish();
                        }
                    }
                    catch
                    {
                        animation = null;
                    }

                    if (!cancelled && timing.landed !== undefined)
                    {
                        guarded(timing.landed);
                    }

                    if (!abandon)
                    {
                        resolve();
                    }
                }
            };

            const stop = schedule(delay + duration, () => live.end(false, false));

            lives.add(live);

            return {
                done,
                length: delay + duration,
                cancel()
                {
                    if (!ended)
                    {
                        live.end(true, false);

                        return;
                    }

                    const held = animation;

                    animation = null;

                    try
                    {
                        held?.cancel();
                    }
                    catch (error)
                    {
                        options.report?.(error);
                    }
                },
                finish: () => live.end(false, false)
            };
        },

        after: (ms, run) => schedule(ms, run),

        wait: (ms) => new Promise<void>((resolve) =>
        {
            schedule(ms, resolve);
        }),

        land()
        {
            for (const live of [...lives])
            {
                live.end(false, false);
            }
        },

        clear()
        {
            for (const live of [...lives])
            {
                live.end(true, true);
            }

            for (const due of dues)
            {
                due.stop();
            }

            dues.clear();
        }
    };
}
