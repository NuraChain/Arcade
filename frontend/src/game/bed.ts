import { runtime } from '../lib/runtime.ts';
import { createSound, onBed, type SoundHandle } from './sound.ts';

/** What the background should be doing: which bed, how loud, whether a call is on, whether the page is seen. */
export interface BedWant
{
    url: string;
    volume: number;
    ducked: boolean;
    hidden: boolean;
}

/** Nothing; waiting to be let play; playing; playing under a call; held while the tab is hidden. */
export type BedState = 'off' | 'waiting' | 'playing' | 'ducked' | 'paused';

export interface Bed
{
    set(want: BedWant | null): void;
    state(): BedState;
    dispose(): void;
}

/** Seconds the bed takes to come in, to go, and to hand its loop from one copy to the other. */
export const FADE_IN = 2;

export const FADE_OUT = 1;

export const CROSS = 4;

/** How far under a call the background sits: 9 dB. */
export const DUCK = 10 ** (-9 / 20);

/** How quickly a new volume, or a call coming or going, is followed. */
const EASE = 0.4;

const GESTURES = ['pointerup', 'touchend', 'click', 'keydown'] as const;

interface Copy
{
    element: HTMLAudioElement;
    gain: GainNode | null;
}

/** A quarter of a sine: the copy coming in rises as the one going falls, and their power stays the same. */
const bend = (rising: boolean) => Float32Array.from({ length: 33 }, (_, index) => (rising ? Math.sin : Math.cos)(index / 32 * Math.PI / 2));

/**
 * One bed behind a table, on the page's own context: two copies of the file from one object URL, each
 * through a gain of its own into a level that is the reader's volume, so the loop is handed from one copy
 * to the other over `CROSS` seconds with no gap and nothing decoded is held in memory. `set` says what it
 * should be doing and it follows, fading; `told` hears what it is doing.
 */
export function createBed(told: (state: BedState) => void = () => undefined): Bed
{
    let want: BedWant | null = null;
    let current: BedState = 'off';
    let handle: SoundHandle | null = null;
    let unhook: (() => void) | null = null;
    let url = '';
    let failed = '';
    let blob = '';
    let copies: Copy[] = [];
    let lead = 0;
    let context: AudioContext | null = null;
    let level: GainNode | null = null;
    let playing = false;
    let attempt = 0;
    let era = 0;
    let timer: (() => void) | null = null;
    let leaving: (() => void) | null = null;
    let waiting: (() => void) | null = null;

    const say = (next: BedState) =>
    {
        if (next !== current)
        {
            current = next;
            told(next);
        }
    };

    const glide = (param: AudioParam, to: number, seconds: number) =>
    {
        if (context === null)
        {
            return;
        }

        const at = context.currentTime;

        param.cancelScheduledValues(at);
        param.setValueAtTime(param.value, at);
        param.linearRampToValueAtTime(to, at + seconds);
    };

    const fix = (param: AudioParam, to: number) =>
    {
        if (context !== null)
        {
            param.cancelScheduledValues(context.currentTime);
            param.setValueAtTime(to, context.currentTime);
        }
    };

    const copy = (): Copy =>
    {
        const element = new Audio();

        element.preload = 'auto';
        element.src = blob;

        return { element, gain: null };
    };

    const stopTimer = () =>
    {
        timer?.();
        timer = null;
    };

    const unwait = () =>
    {
        waiting?.();
        waiting = null;
    };

    /** A browser that would not let the bed play is asked again inside the reader's next press. */
    const awaitPress = () =>
    {
        if (waiting !== null || typeof window === 'undefined')
        {
            return;
        }

        const press = () =>
        {
            unwait();
            follow();
        };

        for (const name of GESTURES)
        {
            window.addEventListener(name, press, { capture: true, passive: true });
        }

        waiting = () =>
        {
            for (const name of GESTURES)
            {
                window.removeEventListener(name, press, { capture: true });
            }
        };
    };

    const wire = () =>
    {
        const into = level;

        if (context === null || into === null)
        {
            return;
        }

        for (const [index, one] of copies.entries())
        {
            if (one.gain === null)
            {
                const source = context.createMediaElementSource(one.element);

                one.gain = context.createGain();
                one.gain.gain.value = index === lead ? 1 : 0;
                source.connect(one.gain);
                one.gain.connect(into);
            }
        }
    };

    const schedule = () =>
    {
        stopTimer();

        const element = copies[lead]?.element;

        if (element === undefined)
        {
            return;
        }

        if (!Number.isFinite(element.duration))
        {
            const known = () =>
            {
                element.removeEventListener('loadedmetadata', known);

                if (playing)
                {
                    schedule();
                }
            };

            element.addEventListener('loadedmetadata', known);
            timer = () => element.removeEventListener('loadedmetadata', known);
            return;
        }

        timer = runtime().clock.after(Math.max(0, element.duration - CROSS - element.currentTime) * 1000, cross);
    };

    const curve = (gain: GainNode, rising: boolean, at: number) =>
    {
        gain.gain.cancelScheduledValues(at);
        gain.gain.setValueCurveAtTime(bend(rising), at, CROSS);
    };

    const cross = () =>
    {
        timer = null;

        const from = copies[lead];
        const to = copies[1 - lead];

        if (context === null || !playing || from === undefined || to === undefined || from.gain === null || to.gain === null)
        {
            return;
        }

        const at = context.currentTime;

        to.element.currentTime = 0;
        void Promise.resolve(to.element.play()).catch(() => undefined);
        curve(from.gain, false, at);
        curve(to.gain, true, at);
        lead = 1 - lead;
        timer = runtime().clock.after(CROSS * 1000, () =>
        {
            timer = null;
            from.element.pause();
            schedule();
        });
    };

    const start = (target: number) =>
    {
        const element = copies[lead].element;
        const mine = attempt + 1;

        attempt = mine;
        playing = true;

        void Promise.resolve(element.play()).then(() =>
        {
            if (mine !== attempt || level === null || want === null)
            {
                return;
            }

            glide(level.gain, target, FADE_IN);
            schedule();
            say(want.ducked ? 'ducked' : 'playing');
        }, () =>
        {
            if (mine !== attempt)
            {
                return;
            }

            playing = false;
            say('waiting');
            awaitPress();
        });
    };

    /** A hidden tab: both copies stopped where they are, the level at nothing, the loop's lead kept whole. */
    const hold = () =>
    {
        attempt += 1;
        playing = false;
        stopTimer();

        for (const [index, one] of copies.entries())
        {
            one.element.pause();

            if (one.gain !== null)
            {
                fix(one.gain.gain, index === lead ? 1 : 0);
            }
        }

        if (level !== null)
        {
            fix(level.gain, 0);
        }
    };

    const follow = () =>
    {
        if (want === null)
        {
            return;
        }

        if (want.url === failed)
        {
            say('off');
            return;
        }

        if (level !== null && want.url !== url)
        {
            load(want.url);
        }

        if (level === null || copies.length === 0 || copies[0].gain === null)
        {
            say('waiting');
            return;
        }

        if (want.hidden)
        {
            hold();
            say('paused');
            return;
        }

        const target = want.volume * (want.ducked ? DUCK : 1);

        if (!playing)
        {
            start(target);
            return;
        }

        glide(level.gain, target, EASE);
        say(want.ducked ? 'ducked' : 'playing');
    };

    /** Forgets the bed in hand, its copies and its address, and keeps the context and the level. */
    const drop = () =>
    {
        era += 1;
        attempt += 1;
        playing = false;
        stopTimer();
        unwait();

        for (const one of copies)
        {
            one.element.pause();
            one.element.removeAttribute('src');
            one.gain?.disconnect();
        }

        copies = [];
        lead = 0;

        if (blob !== '')
        {
            URL.revokeObjectURL(blob);
            blob = '';
        }

        url = '';
    };

    const load = (address: string) =>
    {
        drop();
        url = address;

        if (level !== null)
        {
            fix(level.gain, 0);
        }

        const at = era;

        void fetch(address)
            .then((response) => response.ok ? response.blob() : Promise.reject(new Error(String(response.status))))
            .then((body) =>
            {
                if (at !== era)
                {
                    return;
                }

                blob = URL.createObjectURL(new Blob([body], { type: 'audio/mpeg' }));
                copies = [copy(), copy()];
                wire();
                follow();
            })
            .catch(() =>
            {
                if (at === era)
                {
                    failed = address;
                    follow();
                }
            });
    };

    /** The page's context runs: the first time, or again after a pause, or a new one after the old one stalled. */
    const attach = (running: AudioContext, into: AudioNode) =>
    {
        if (running !== context)
        {
            const at = copies[lead]?.element.currentTime ?? 0;
            const wired = copies.length > 0 && copies[0].gain !== null;

            level?.disconnect();
            context = running;
            level = running.createGain();
            level.gain.value = 0;
            level.connect(into);
            playing = false;

            if (wired)
            {
                for (const one of copies)
                {
                    one.element.pause();
                }

                copies = [copy(), copy()];
                copies[lead].element.currentTime = at;
            }

            wire();
        }

        follow();
    };

    const release = () =>
    {
        drop();
        failed = '';
        unhook?.();
        unhook = null;
        level?.disconnect();
        level = null;
        context = null;
        handle?.dispose();
        handle = null;
    };

    const leave = () =>
    {
        say('off');
        unwait();

        if (level === null || !playing)
        {
            release();
            return;
        }

        stopTimer();
        glide(level.gain, 0, FADE_OUT);
        leaving = runtime().clock.after(FADE_OUT * 1000, () =>
        {
            leaving = null;
            release();
        });
    };

    return {
        set: (next) =>
        {
            if (next === null)
            {
                if (want !== null)
                {
                    want = null;
                    leave();
                }

                return;
            }

            const fresh = want === null;

            want = next;

            if (fresh)
            {
                leaving?.();
                leaving = null;
                handle ??= createSound(true);
                unhook ??= onBed(attach);
            }

            follow();

            if (playing && fresh && timer === null && level !== null)
            {
                schedule();
            }
        },

        state: () => current,

        dispose: () =>
        {
            want = null;
            leaving?.();
            leaving = null;
            say('off');
            release();
        }
    };
}
