import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, renderTest } from '@azerothjs/testing';

import TablePlate from '../src/components/games/table-plate.component.azeroth';
import { plateTag } from '../src/components/games/plate-tag.ts';
import '../src/locales/app-catalogue.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import type { MatchPlayer } from '../src/data/match.ts';

type Rendered = HTMLElement;

afterEach(() => cleanup());

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

    it('draws no clock for a watcher, who is sent no deadline', () =>
    {
        const { container } = renderTest(() => TablePlate({ who: 'omid.k', name: 'Omid', turn: true, turnMs: 30000 }) as Rendered);

        expect(container.querySelector('.table-plate-clock')).toBeNull();
    });

    it('writes out only the states worth reading, and says the last miss in the danger tone', () =>
    {
        const locale = useLocale();
        const player = (timeouts: number, result?: MatchPlayer['result']): MatchPlayer => ({ seat: 1, who: 'sara.k', timeouts, ...(result === undefined ? {} : { result }) }) as MatchPlayer;

        expect(plateTag(locale, player(0), false)).toBeNull();
        expect(plateTag(locale, player(1), false)?.tone).toBe('gold');
        expect(plateTag(locale, player(2), false)).toEqual({ text: locale.t('card.lastChance'), tone: 'danger' });
        expect(plateTag(locale, player(0, 'won'), true)).toEqual({ text: locale.t('card.won'), tone: 'live' });
        expect(plateTag(locale, player(2), true)).toBeNull();
    });
});
