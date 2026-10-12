import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fire, renderTest } from '@azerothjs/testing';
import { createSignal } from 'azerothjs';

import CoachLine from '../src/components/games/coach-line.component.azeroth';
import type { Tip } from '../src/game/helpers/tip.ts';
import '../src/locales/app-catalogue.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useSettings } from '../src/stores/settings.store.ts';

type Rendered = HTMLElement;

const UPRIGHT: Tip = { key: 'match.upright' };

const FOLLOW: Tip = { key: 'hokm.follow' };

const lamp = (first: Tip | null) =>
{
    const [tip, setTip] = createSignal<Tip | null>(first);
    const { container } = renderTest(() => CoachLine({ get tip()
    {
        return tip();
    }, lamp: true }) as Rendered);

    return { container, say: setTip, note: () => container.querySelector<HTMLElement>('.coach-line') };
};

beforeEach(() =>
{
    cleanup();
    useLocale().setLocale('en');
    useSettings().reset();
});

afterEach(() =>
{
    cleanup();
    useSettings().reset();
});

describe('the lamp a tip is read from', () =>
{
    it('is the lamp it was when the same tip is handed over again, open and under the keyboard', () =>
    {
        const { say, note } = lamp(UPRIGHT);
        const first = note()!;

        fire(first, 'click');
        first.focus();
        say({ ...UPRIGHT });

        expect(note(), 'the lamp was drawn again for a tip it already had').toBe(first);
        expect(first.getAttribute('data-open'), 'a tip that was open closed itself').toBe('true');
        expect(document.activeElement).toBe(first);
    });

    it('changes its words where it stands when the tip does', () =>
    {
        const { say, note } = lamp(UPRIGHT);
        const first = note()!;

        say(FOLLOW);

        expect(note()).toBe(first);
        expect(first.textContent).toContain(useLocale().t('hokm.follow'));
        expect(first.textContent).not.toContain(useLocale().t('match.upright'));
    });

    it('goes when there is nothing to say and comes back when there is', () =>
    {
        const { say, note } = lamp(UPRIGHT);

        say(null);
        expect(note()).toBeNull();

        say(FOLLOW);
        expect(note()?.textContent).toContain(useLocale().t('hokm.follow'));
    });

    it('is not drawn for somebody who switched the coach off, and returns with the switch', () =>
    {
        const { note } = lamp(UPRIGHT);

        useSettings().update({ hintRules: false });
        expect(note()).toBeNull();

        useSettings().update({ hintRules: true });
        expect(note()?.getAttribute('data-lamp')).toBe('true');
    });
});
