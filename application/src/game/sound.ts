/**
 * The table's sounds, synthesised rather than fetched.
 *
 * Six cues, none of them a file: a die landing, a token ticking over a square, a capture, a token
 * coming home, a win, and the moment a turn becomes yours. Every one is an envelope over one or two
 * oscillators, which is a few hundred bytes of code against the hundred kilobytes of audio a sprite
 * sheet of the same six would cost - and there is nothing to decode, nothing to cache and nothing
 * that can 404 halfway through a game.
 *
 * **It is armed by a gesture and never before.** Phaser's own audio is turned off in the board's
 * config because an `AudioContext` opened at boot makes Chrome log "The AudioContext was not allowed
 * to start", and the 640-cell matrix reads every console line - so a sound nothing plays would fail
 * whole routes. The same rule applies to this: the context is not constructed until a pointer or a
 * key has been through the window, which is the browser's own definition of permission. Before that
 * every cue is a no-op rather than a queued noise, because a sound that arrives a minute late
 * belongs to a moment that has passed.
 *
 * `settings.sound` is off by default, so the ordinary path is that none of this ever runs. Imports
 * nothing, like everything else under `game/`.
 */

export type Cue = 'roll' | 'step' | 'capture' | 'home' | 'win' | 'turn';

export interface SoundHandle
{
    play(cue: Cue): void;

    setEnabled(on: boolean): void;

    dispose(): void;
}

interface Voice
{
    wave: OscillatorType;
    from: number;
    to: number;
    hold: number;
    gain: number;
    delay: number;
}

/**
 * A cue is a small chord of falling or rising tones. Nothing here is a chromatic pitch: they are
 * chosen so the six are told apart by shape - a tick is short and bright, a capture drops, a win
 * climbs - which is what matters when they arrive over each other during a fast turn.
 */
const CUES: Record<Cue, readonly Voice[]> = {
    roll: [
        { wave: 'triangle', from: 220, to: 140, hold: 0.09, gain: 0.30, delay: 0 },
        { wave: 'triangle', from: 300, to: 190, hold: 0.07, gain: 0.22, delay: 0.05 },
        { wave: 'sine', from: 180, to: 120, hold: 0.12, gain: 0.26, delay: 0.11 }
    ],
    step: [
        { wave: 'sine', from: 760, to: 700, hold: 0.05, gain: 0.14, delay: 0 }
    ],
    capture: [
        { wave: 'sawtooth', from: 420, to: 90, hold: 0.24, gain: 0.26, delay: 0 },
        { wave: 'square', from: 210, to: 70, hold: 0.18, gain: 0.12, delay: 0.02 }
    ],
    home: [
        { wave: 'sine', from: 520, to: 780, hold: 0.14, gain: 0.24, delay: 0 },
        { wave: 'sine', from: 780, to: 1040, hold: 0.20, gain: 0.18, delay: 0.10 }
    ],
    win: [
        { wave: 'triangle', from: 392, to: 392, hold: 0.16, gain: 0.26, delay: 0 },
        { wave: 'triangle', from: 523, to: 523, hold: 0.16, gain: 0.26, delay: 0.13 },
        { wave: 'triangle', from: 659, to: 659, hold: 0.18, gain: 0.26, delay: 0.26 },
        { wave: 'triangle', from: 784, to: 784, hold: 0.42, gain: 0.30, delay: 0.39 }
    ],
    turn: [
        { wave: 'sine', from: 600, to: 900, hold: 0.11, gain: 0.20, delay: 0 }
    ]
};

const MASTER = 0.5;

type ContextMaker = typeof AudioContext;

function contextMaker(): ContextMaker | null
{
    const scope = globalThis as unknown as { AudioContext?: ContextMaker; webkitAudioContext?: ContextMaker };

    return scope.AudioContext ?? scope.webkitAudioContext ?? null;
}

export function createSound(enabled: boolean): SoundHandle
{
    let on = enabled;
    let context: AudioContext | null = null;
    let master: GainNode | null = null;
    let dropped = false;

    const arm = (): void =>
    {
        release();

        if (dropped || context !== null)
        {
            return;
        }

        const Maker = contextMaker();

        if (Maker === null)
        {
            return;
        }

        try
        {
            context = new Maker();
            master = context.createGain();
            master.gain.value = MASTER;
            master.connect(context.destination);
        }
        catch
        {
            context = null;
            master = null;
        }
    };

    const release = (): void =>
    {
        window.removeEventListener('pointerdown', arm);
        window.removeEventListener('keydown', arm);
    };

    window.addEventListener('pointerdown', arm, { passive: true });
    window.addEventListener('keydown', arm, { passive: true });

    return {
        play: (cue) =>
        {
            if (!on || context === null || master === null || context.state === 'closed')
            {
                return;
            }

            const at = context.currentTime;

            for (const voice of CUES[cue])
            {
                const source = context.createOscillator();
                const level = context.createGain();

                source.type = voice.wave;
                source.frequency.setValueAtTime(voice.from, at + voice.delay);
                source.frequency.exponentialRampToValueAtTime(Math.max(1, voice.to), at + voice.delay + voice.hold);

                level.gain.setValueAtTime(0.0001, at + voice.delay);
                level.gain.exponentialRampToValueAtTime(voice.gain, at + voice.delay + 0.012);
                level.gain.exponentialRampToValueAtTime(0.0001, at + voice.delay + voice.hold);

                source.connect(level);
                level.connect(master);

                source.start(at + voice.delay);
                source.stop(at + voice.delay + voice.hold + 0.02);
            }
        },

        setEnabled: (next) =>
        {
            on = next;
        },

        dispose: () =>
        {
            dropped = true;
            on = false;

            release();

            const closing = context;

            context = null;
            master = null;

            void closing?.close().catch(() => undefined);
        }
    };
}
