import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, fire, renderTest } from '@azerothjs/testing';
import { createSignal } from 'azerothjs';

import TablePlate from '../src/components/games/table-plate.component.azeroth';
import { plateTag } from '../src/components/games/plate-tag.ts';
import PersonActions from '../src/components/social/person-actions.component.azeroth';
import * as turns from '../../backend/src/domains/match/turns.ts';
import { manualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import '../src/locales/app-catalogue.ts';
import { useDevice } from '../src/stores/device.store.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useOverlay } from '../src/stores/overlay.store.ts';
import { useRealtime } from '../src/stores/realtime.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { setVoiceCall, setVoiceMedia, useVoice } from '../src/stores/voice.store.ts';
import { socket } from './fake-realtime.ts';
import type { MatchPlayer } from '../src/data/match.ts';

type Rendered = HTMLElement;

afterEach(() =>
{
    cleanup();
    resetRuntime();
    vi.restoreAllMocks();
});

describe('the seat plate every table draws', () =>
{
    it('names the player in their own direction and marks the seat whose turn it is', () =>
    {
        const { container } = renderTest(() => TablePlate({ who: 'sara.k', name: 'سارا', turn: true }) as Rendered);
        const plate = container.querySelector<HTMLElement>('.table-plate')!;

        expect(plate.getAttribute('aria-current')).toBe('true');
        expect(plate.querySelector('.table-plate-name')!.getAttribute('dir')).toBe('auto');
    });

    it('runs the turn clock only for the seat on turn, from what is left of the whole turn', () =>
    {
        const waiting = renderTest(() => TablePlate({ who: 'omid.k', name: 'Omid', turn: false, remainingMs: 15000, turnMs: 30000 }) as Rendered);
        expect(waiting.container.querySelector('.table-plate-clock')).toBeNull();
        waiting.unmount();

        const { container } = renderTest(() => TablePlate({ who: 'omid.k', name: 'Omid', turn: true, remainingMs: 15000, turnMs: 30000 }) as Rendered);
        const clock = container.querySelector<SVGElement>('.table-plate-clock')!;

        expect(clock.getAttribute('style')).toContain('--from: 0.5000');
        expect(clock.getAttribute('style')).toContain('--ms: 15000ms');
    });

    it('holds a day-long turn still and moves it once a minute, rather than repainting it every frame for a day', () =>
    {
        const day = 24 * 60 * 60 * 1000;
        const { container } = renderTest(() => TablePlate({ who: 'omid.k', name: 'Omid', turn: true, remainingMs: day / 2, turnMs: day }) as Rendered);
        const clock = container.querySelector<SVGElement>('.table-plate-clock')!;

        expect(clock.dataset.still).toBe('true');
        expect(clock.getAttribute('style')).toContain('--from: 0.5000');
        expect(clock.getAttribute('style')).not.toContain('--ms');
    });

    it('draws the turn still and steps it once a second for somebody who asked for less motion, whose browser ends an animation as it starts', () =>
    {
        const clock = manualClock(400_000);

        setRuntime({ clock, seed: 1 });
        vi.spyOn(useDevice(), 'reducedMotion').mockReturnValue(true);

        const [left, setLeft] = createSignal(15_000);
        const { container } = renderTest(() => TablePlate({
            who: 'omid.k',
            name: 'Omid',
            turn: true,
            get remainingMs()
            {
                return left();
            },
            turnMs: 30_000
        }) as Rendered);
        const ring = container.querySelector<SVGElement>('.table-plate-clock')!;
        const drawn = () => container.querySelector<SVGElement>('.table-plate-clock')?.getAttribute('style') ?? '';

        expect([ring.dataset.still, drawn()], 'the ring was left to an animation that less motion ends at once, which draws the turn as spent').toEqual(['true', '--from: 0.5000']);

        clock.advance(1000);

        expect(drawn()).toBe('--from: 0.4667');

        clock.advance(4000);

        expect(drawn()).toBe('--from: 0.3333');

        clock.advance(20_000);

        expect(drawn(), 'the ring ran on past empty').toBe('--from: 0.0000');

        setLeft(30_000);

        expect(drawn(), 'a new count was drawn from where the old one had got to').toBe('--from: 1.0000');
        expect(container.querySelector('.table-plate-clock'), 'the ring was made again for a count it only had to be told').toBe(ring);

        clock.advance(500);
        setLeft(29_000);

        expect(drawn()).toBe('--from: 0.9667');

        clock.advance(500);

        expect(drawn(), 'the step after a count heard between two beats was not measured from when it was heard').toBe('--from: 0.9500');
    });

    it('steps once a second only where it has to: a turn that moves by itself, a turn that is somebody else\'s and a turn of a day are left to the minute', () =>
    {
        const clock = manualClock(400_000);
        const every = vi.spyOn(clock, 'every');
        const day = 24 * 60 * 60 * 1000;

        setRuntime({ clock, seed: 1 });

        const paced = (quiet: boolean, turn: boolean, remainingMs: number) =>
        {
            vi.spyOn(useDevice(), 'reducedMotion').mockReturnValue(quiet);
            every.mockClear();

            const drawn = renderTest(() => TablePlate({ who: 'omid.k', name: 'Omid', turn, remainingMs, turnMs: remainingMs * 2 }) as Rendered);
            const paces = every.mock.calls.map(([ms]) => ms);

            drawn.unmount();

            return paces;
        };

        expect(paced(true, true, 15_000)).toEqual([1000]);
        expect(paced(false, true, 15_000)).toEqual([60_000]);
        expect(paced(true, false, 15_000)).toEqual([60_000]);
        expect(paced(true, true, day / 2)).toEqual([60_000]);
        expect(clock.pending(), 'a plate that was taken away went on counting').toBe(0);
    });

    it('changes its step when the turn comes to its seat, and keeps one count running, not two', () =>
    {
        const clock = manualClock(400_000);
        const every = vi.spyOn(clock, 'every');

        setRuntime({ clock, seed: 1 });
        vi.spyOn(useDevice(), 'reducedMotion').mockReturnValue(true);

        const [turn, setTurn] = createSignal(false);

        renderTest(() => TablePlate({
            who: 'omid.k',
            name: 'Omid',
            get turn()
            {
                return turn();
            },
            remainingMs: 15_000,
            turnMs: 30_000
        }) as Rendered);

        setTurn(true);

        expect(every.mock.calls.map(([ms]) => ms)).toEqual([60_000, 1000]);
        expect(clock.pending()).toBe(1);

        setTurn(false);

        expect(every.mock.calls.map(([ms]) => ms)).toEqual([60_000, 1000, 60_000]);
        expect(clock.pending()).toBe(1);
    });

    it('marks the side a seat plays for, and says it to somebody who cannot see the colour', () =>
    {
        const { container } = renderTest(() => TablePlate({ who: 'sara.k', name: 'Sara', team: { side: 1, says: 'Opponent' } }) as Rendered);
        const plate = container.querySelector<HTMLElement>('.table-plate')!;
        const mark = plate.querySelector<HTMLElement>('.table-plate-team')!;

        expect(plate.dataset.team).toBe('1');
        expect(mark.dataset.side).toBe('1');
        expect(mark.querySelector('.sr-only')!.textContent).toBe('Opponent');
    });

    it('marks the reader\'s own side with nothing said, because the plate already says who it is', () =>
    {
        const { container } = renderTest(() => TablePlate({ who: 'dana.w', name: 'You', team: { side: 0 } }) as Rendered);
        const mark = container.querySelector<HTMLElement>('.table-plate-team')!;

        expect(mark.dataset.side).toBe('0');
        expect(mark.querySelector('.sr-only')).toBeNull();
    });

    it('draws no side mark at a table where every seat plays for itself', () =>
    {
        const { container } = renderTest(() => TablePlate({ who: 'sara.k', name: 'Sara' }) as Rendered);

        expect(container.querySelector('.table-plate-team')).toBeNull();
        expect(container.querySelector<HTMLElement>('.table-plate')!.dataset.team).toBeUndefined();
    });

    it('builds what it is handed once: a mark, a line of its own and a trailing piece are each read a single time', async () =>
    {
        const built = { marker: 0, facts: 0, trail: 0 };
        const [rolled, setRolled] = createSignal(true);

        const piece = (slot: keyof typeof built) =>
        {
            const node = document.createElement('i');

            built[slot] += 1;
            node.className = `handed-${ slot }`;

            return node;
        };

        const { container } = renderTest(() => TablePlate({
            who: 'sara.k',
            name: 'Sara',
            get marker()
            {
                return piece('marker');
            },
            get facts()
            {
                return piece('facts');
            },
            get trail()
            {
                return rolled() ? piece('trail') : undefined;
            }
        }) as Rendered);

        expect(built, 'a piece handed to the plate was built more than once, and whatever lives in the spare one runs twice').toEqual({ marker: 1, facts: 1, trail: 1 });
        expect(container.querySelectorAll('.table-plate-marker > .handed-marker, .table-plate-facts > .handed-facts, .table-plate-trail > .handed-trail')).toHaveLength(3);

        setRolled(false);
        await Promise.resolve();

        expect(container.querySelector('.table-plate-trail')).toBeNull();

        setRolled(true);
        await Promise.resolve();

        expect(built).toEqual({ marker: 1, facts: 1, trail: 2 });
        expect(container.querySelectorAll('.table-plate-trail > .handed-trail')).toHaveLength(1);
    });

    it('draws no holder for a piece it was not handed', () =>
    {
        const { container } = renderTest(() => TablePlate({ who: 'sara.k', name: 'Sara' }) as Rendered);

        expect(container.querySelector('.table-plate-marker, .table-plate-facts, .table-plate-trail')).toBeNull();
    });

    it('wears a ring on the whole plate while its player is heard, where the turn clock cannot cover it', async () =>
    {
        useRealtime().reset();
        socket.reset();
        useSession().reset();
        useSession().establish({ id: 'alex', handle: 'alex', displayName: 'Alex', bio: '', hue: 210, isMinor: false });
        useVoice().reset();
        setVoiceMedia(() => ({ getUserMedia: async () => ({ getTracks: () => [], getAudioTracks: () => [] }) }) as unknown as MediaDevices);

        const stopVoice = useVoice().start();

        let heard: ((who: string, level: number) => void) | null = null;

        setVoiceCall((deps) =>
        {
            heard = deps.onLevel;

            return {
                setMic: async () => undefined,
                setMuted: () => undefined,
                sync: () => undefined,
                receive: async () => undefined,
                heard: () => undefined,
                setVolume: () => undefined,
                setSink: () => undefined,
                setQuality: () => undefined,
                facts: async () => ({}),
                close: () => undefined
            };
        });

        try
        {
            useRealtime().start();
            socket.accept();
            await useVoice().join('table-ring');
            socket.deliver({
                v: 1,
                t: 'voice',
                n: 41,
                table: 'table-ring',
                joined: true,
                mine: 'join-alex',
                peers: [
                    { who: 'alex', muted: true, talk: true, join: 'join-alex', opus: false },
                    { who: 'sara.k', muted: false, talk: true, join: 'join-sara', opus: false }
                ]
            });

            const { container } = renderTest(() => TablePlate({ who: 'sara.k', name: 'Sara', turn: true, remainingMs: 20_000, turnMs: 30_000 }) as HTMLElement);
            const plate = container.querySelector<HTMLElement>('.table-plate')!;

            expect(plate.dataset.speaking).toBeUndefined();

            heard!('sara.k', 0.6);
            await Promise.resolve();

            expect(plate.dataset.speaking, 'the plate of somebody speaking says nothing of it').toBe('true');
            expect(container.querySelector('.table-plate'), 'the plate was drawn again to say so').toBe(plate);
        }
        finally
        {
            useVoice().reset();
            stopVoice();
            setVoiceCall(null);
            setVoiceMedia(null);
            useRealtime().reset();
        }
    });

    it('draws no clock for a watcher, who is sent no deadline', () =>
    {
        const { container } = renderTest(() => TablePlate({ who: 'omid.k', name: 'Omid', turn: true, turnMs: 30000 }) as Rendered);

        expect(container.querySelector('.table-plate-clock')).toBeNull();
    });

    it('writes out only the states worth reading, and says the last miss in the danger tone', () =>
    {
        const locale = useLocale();
        const player = (timeouts: number, result?: MatchPlayer['result']) => ({ seat: 1, who: 'sara.k', timeouts, ...(result === undefined ? {} : { result }) }) as MatchPlayer;

        expect(plateTag(locale, player(0), false)).toBeNull();
        expect(plateTag(locale, player(1), false)?.tone).toBe('gold');
        expect(plateTag(locale, player(turns.MISSES_ALLOWED - 1), false)).toEqual({ text: locale.plural('card.missed', turns.MISSES_ALLOWED - 1), tone: 'danger' });
        expect(plateTag(locale, player(0, 'won'), true)).toEqual({ text: locale.t('card.won'), tone: 'live' });
        expect(plateTag(locale, player(0, 'void'), true)).toEqual({ text: locale.t('card.void'), tone: 'neutral' });
        expect(locale.t('card.void')).not.toBe('card.void');
        expect(plateTag(locale, player(0, 'drawn'), true)).toEqual({ text: locale.t('card.drawn'), tone: 'neutral' });
        expect(locale.t('card.drawn')).toBe('Draw');
        expect(plateTag(locale, player(turns.MISSES_ALLOWED - 1), true)).toBeNull();
    });

    it('writes nothing about missed turns for a seat that came without a count, as every seat of a game being watched does', () =>
    {
        const locale = useLocale();
        const watched: MatchPlayer = { seat: 1, who: 'sara.k' };

        expect(plateTag(locale, watched, false)).toBeNull();
        expect(plateTag(locale, { ...watched, result: 'abandoned' }, false)).toEqual({ text: locale.t('card.out'), tone: 'neutral' });
    });

    it.each([
        ['en', 'Gave up', 'Left', 'Timeout'],
        ['fa', 'تسلیم شد', 'ترک کرد', 'وقت تمام']
    ] as const)('says which way a seat went out of the game: gave up, walked away or ran out of time, in %s', (language, gaveUp, left, timedOut) =>
    {
        const locale = useLocale();
        const gone = (exit?: MatchPlayer['exit']): MatchPlayer => ({ seat: 1, who: 'sara.k', result: 'abandoned', ...(exit === undefined ? {} : { exit }) });

        locale.setLocale(language);

        expect(plateTag(locale, gone('resign'), false)?.text).toBe(gaveUp);
        expect(plateTag(locale, gone('left'), false)?.text).toBe(left);
        expect(plateTag(locale, gone('timeout'), false)?.text).toBe(timedOut);
        expect(plateTag(locale, gone(), true)?.text, 'a seat that came without the way it went').toBe(left);
        expect(plateTag(locale, gone('resign'), true)?.tone).toBe('neutral');

        locale.setLocale('en');
    });

    it('warns on the miss the server’s own rule calls the last, so a different limit moves the warning with it', () =>
    {
        vi.spyOn(turns, 'nextMissForfeits').mockImplementation((timeouts) => timeouts + 1 >= 5);

        const locale = useLocale();
        const tone = (timeouts: number) => plateTag(locale, { seat: 1, who: 'sara.k', timeouts } as MatchPlayer, false)?.tone;

        expect([1, 2, 3, 4].map(tone)).toEqual(['gold', 'gold', 'gold', 'danger']);
    });

    it.each([
        ['en', 'Missed 1', 'Missed 2', 'Missed 3', 'Void'],
        ['fa', 'یه غیبت', '۲ غیبت', '۳ غیبت', 'بی‌نتیجه']
    ] as const)('says a missed turn as a count a narrow plate has room for, and the last one allowed in the danger tone, in %s', (language, once, twice, thrice, void_) =>
    {
        vi.spyOn(turns, 'nextMissForfeits').mockImplementation((timeouts) => timeouts + 1 >= 4);

        const locale = useLocale();
        const said = (timeouts: number) => plateTag(locale, { seat: 1, who: 'sara.k', timeouts } as MatchPlayer, false);

        locale.setLocale(language);

        expect([1, 2, 3].map((timeouts) => said(timeouts)?.text)).toEqual([once, twice, thrice]);
        expect([1, 2, 3].map((timeouts) => said(timeouts)?.tone)).toEqual(['gold', 'gold', 'danger']);
        expect(plateTag(locale, { seat: 1, who: 'sara.k', result: 'void' } as MatchPlayer, true)?.text).toBe(void_);

        locale.setLocale('en');
    });
});

describe('a plate that is pressed', () =>
{
    const reading = () =>
    {
        useSession().reset();
        useSession().establish({ id: 'alex', handle: 'alex', displayName: 'Alex', bio: '', hue: 210, isMinor: false });
        useOverlay().reset();
        useLocale().setLocale('en');
    };

    const press = (container: HTMLElement) => container.querySelector<HTMLButtonElement>('.table-plate-press');

    afterEach(() =>
    {
        useOverlay().reset();
        useSession().reset();
        useLocale().setLocale('en');
    });

    it('lays one button over everything on the plate of somebody else, named for them, and leaves it out of the keys\' way: a key reaches the same sheet from the list of players', () =>
    {
        reading();

        const { container } = renderTest(() => TablePlate({ who: 'omid.k', name: 'Omid', turn: true, tag: 'Missed 1', bubble: 'gg', facts: document.createElement('i'), trail: document.createElement('b') }) as Rendered);
        const plate = container.querySelector<HTMLElement>('.table-plate')!;
        const over = press(container)!;

        expect(plate.querySelectorAll('button')).toHaveLength(1);
        expect(plate.lastElementChild, 'something on the plate is drawn over the press').toBe(over);
        expect([over.type, over.getAttribute('tabindex'), over.getAttribute('aria-haspopup'), over.getAttribute('aria-label'), over.textContent])
            .toEqual(['button', '-1', 'dialog', 'More about Omid', '']);
    });

    it('opens what can be done about that person, and one sheet however often it is pressed', async () =>
    {
        reading();

        const { container } = renderTest(() => TablePlate({ who: 'omid.k', name: 'Omid' }) as Rendered);

        fire(press(container)!, 'click');
        fire(press(container)!, 'click');

        await vi.waitFor(() => expect(useOverlay().items()).toHaveLength(1), { timeout: 4000 });

        expect(useOverlay().items().map((entry) => [entry.id, entry.component, entry.label, entry.props.personId]))
            .toEqual([['person-menu', PersonActions, 'More', 'omid.k']]);
    });

    it('is about whoever the plate is showing now, when the seat it draws changes hands', async () =>
    {
        reading();

        const [who, setWho] = createSignal('omid.k');
        const { container } = renderTest(() => TablePlate({
            get who()
            {
                return who();
            },
            get name()
            {
                return who() === 'omid.k' ? 'Omid' : 'Mina';
            }
        }) as Rendered);
        const over = press(container)!;

        setWho('mina');
        await Promise.resolve();

        expect(press(container), 'the press was built again').toBe(over);
        expect(over.getAttribute('aria-label')).toBe('More about Mina');

        fire(over, 'click');

        await vi.waitFor(() => expect(useOverlay().items()).toHaveLength(1), { timeout: 4000 });

        expect(useOverlay().items()[0].props.personId).toBe('mina');
    });

    it('is not laid over the reader\'s own plate, and comes and goes with whose plate it is', async () =>
    {
        reading();

        const [who, setWho] = createSignal('alex');
        const { container } = renderTest(() => TablePlate({
            get who()
            {
                return who();
            },
            name: 'You'
        }) as Rendered);

        expect(container.querySelector('button')).toBeNull();

        setWho('omid.k');
        await Promise.resolve();

        expect(press(container)).not.toBeNull();

        setWho('alex');
        await Promise.resolve();

        expect(container.querySelector('button')).toBeNull();
    });

    it('is named in Persian too', () =>
    {
        reading();
        useLocale().setLocale('fa');

        const { container } = renderTest(() => TablePlate({ who: 'omid.k', name: 'امید' }) as Rendered);

        expect(press(container)!.getAttribute('aria-label')).toBe('بیشتر درباره‌ی امید');
    });
});
