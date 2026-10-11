import { createSound, type Cue, type SoundHandle } from '../../game/sound.ts';
import { haptic, type Haptic } from '../../lib/haptics.ts';
import { runtime } from '../../lib/runtime.ts';
import type { EventBatch, MatchEvent } from '../../stores/match.store.ts';

export interface Beat
{
    at: number;
    cue?: Cue;
    gain?: number;
    rate?: number;
    buzz?: Haptic;
}

export interface Seat
{
    mine: number | null;
    seats: number;
}

type Moves<K extends MatchEvent['log']['kind']> = Extract<MatchEvent['log'], { kind: K }>['moves'];

const CARD_GAP = 90;

const CATCH_UP_ACTIONS = 12;

export function pokerBeats(moves: Moves<'poker'>, seat: Seat)
{
    const beats: Beat[] = [];
    let at = 0;

    for (const move of moves)
    {
        const mine = seat.mine !== null && move.seat === seat.mine;

        if (move.e === 'deal')
        {
            beats.push({ at, cue: 'card-shuffle', gain: 0.6 });

            for (let card = 0; card < Math.min(seat.seats * 2, 8); card += 1)
            {
                beats.push({ at: at + 420 + card * 70, cue: 'card-slide', gain: 0.7, rate: 0.97 + (card % 3) * 0.04 });
            }

            at += 420 + Math.min(seat.seats * 2, 8) * 70;
        }
        else if (move.e === 'blind' || move.e === 'call' || move.e === 'raise')
        {
            beats.push({ at, cue: 'chip-lay' });
            at += CARD_GAP;
        }
        else if (move.e === 'allin')
        {
            beats.push({ at, cue: 'chips-stack' });
            at += CARD_GAP;
        }
        else if (move.e === 'check')
        {
            beats.push({ at, cue: 'tick' });
            at += CARD_GAP;
        }
        else if (move.e === 'fold')
        {
            beats.push({ at, cue: 'card-gather', gain: 0.6 });
            at += CARD_GAP;
        }
        else if (move.e === 'board')
        {
            (move.cards ?? []).forEach((_, index) => beats.push({ at: at + index * 120, cue: 'card-place' }));
            at += (move.cards?.length ?? 1) * 120;
        }
        else if (move.e === 'show')
        {
            beats.push({ at, cue: 'card-fan', gain: 0.6 });
            at += CARD_GAP;
        }
        else if (move.e === 'pot')
        {
            const won = seat.mine !== null && (move.winners ?? []).includes(seat.mine);

            beats.push({ at: at + 200, cue: 'chips-stack', buzz: won ? 'hand' : undefined });

            if (won)
            {
                beats.push({ at: at + 320, cue: 'hand-won' });
            }

            at += 400;
        }
        else if (move.e === 'bust' && mine)
        {
            beats.push({ at, cue: 'pass', buzz: 'hit' });
        }
        else if (move.e === 'finish' && mine)
        {
            beats.push({ at: at + 400, cue: 'win', buzz: 'win' });
        }
    }

    return beats;
}

export interface TableCues
{
    hear(batch: EventBatch, match: { id: string; rev: number }): void;
    turn(yours: boolean): void;
    setEnabled(on: boolean): void;
    dispose(): void;
}

export function turnChime(sound: () => SoundHandle | null)
{
    let before: boolean | null = null;

    return (yours: boolean) =>
    {
        if (yours && before === false)
        {
            sound()?.play('turn', { urgent: true });
            haptic('ready');
        }

        before = yours;
    };
}

export function tableCues(options: { enabled: boolean; seq: number; match: { id: string; rev: number }; beats: (events: readonly MatchEvent[]) => Beat[] }): TableCues
{
    const sound = createSound(options.enabled);
    const chime = turnChime(() => sound);
    let heard = options.seq;
    let id = options.match.id;
    let rev = options.match.rev;
    let timers: (() => void)[] = [];

    return {
        hear(batch, match)
        {
            if (batch.seq <= heard)
            {
                return;
            }

            heard = batch.seq;

            if (match.id !== id)
            {
                id = match.id;
                rev = match.rev;
                return;
            }

            const fresh = batch.events.filter((one) => one.rev > rev);

            if (fresh.length === 0)
            {
                return;
            }

            const gap = fresh[0].rev !== rev + 1;

            rev = Math.max(rev, ...fresh.map((one) => one.rev));

            if (gap || fresh.length > CATCH_UP_ACTIONS || (typeof document !== 'undefined' && document.visibilityState === 'hidden'))
            {
                return;
            }

            for (const beat of options.beats(fresh))
            {
                const stop = runtime().clock.after(beat.at, () =>
                {
                    timers = timers.filter((one) => one !== stop);

                    if (beat.cue !== undefined)
                    {
                        sound.play(beat.cue, { gain: beat.gain, rate: beat.rate });
                    }

                    if (beat.buzz !== undefined)
                    {
                        haptic(beat.buzz);
                    }
                });

                timers.push(stop);
            }
        },

        turn: chime,

        setEnabled: (on) => sound.setEnabled(on),

        dispose()
        {
            timers.forEach((stop) => stop());
            timers = [];
            sound.dispose();
        }
    };
}
