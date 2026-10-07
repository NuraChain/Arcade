import { describe, it, expect, afterEach, vi } from 'vitest';
import { RouterProvider, createMemoryHistory, createRouter } from 'azerothjs';
import { cleanup, renderTest } from '@azerothjs/testing';

import KeysBanner from '../src/components/app/keys-banner.component.azeroth';
import '../src/locales/app-catalogue.ts';
import * as enrolment from '../src/stores/enrolment.store.ts';
import { useLocale } from '../src/stores/locale.store.ts';

type Gap = 'absent' | null;

vi.mock('../src/stores/enrolment.store.ts', async () =>
{
    const { createSignal } = await import('azerothjs');
    const [gap, setGap] = createSignal<Gap>('absent');
    const [reads, setReads] = createSignal(0);

    return {
        setGap,
        readAgain: () => setReads(reads() + 1),
        useEnrolment: () => ({
            gap,
            asking: () => reads() >= 0 && gap() !== null,
            dismiss: () => undefined,
            give: async () => undefined
        })
    };
});

vi.mock('../src/api.ts', async () => await import('./fake-api.ts'));

const setGap = (enrolment as unknown as { setGap: (value: Gap) => void }).setGap;

const readAgain = (enrolment as unknown as { readAgain: () => void }).readAgain;

const settle = async () =>
{
    for (let turn = 0; turn < 6; turn += 1)
    {
        await Promise.resolve();
    }
};

afterEach(() =>
{
    cleanup();
    setGap('absent');
});

describe('the keys banner', () =>
{
    it('offers keys while this browser has none, and leaves without throwing when it closes', async () =>
    {
        useLocale().setLocale('en');
        const router = createRouter({ routes: [{ path: '/', component: () => document.createElement('div') }], history: createMemoryHistory('/'), scroll: false });
        const { container } = renderTest(() => RouterProvider({ router, children: () => KeysBanner({}) }) as HTMLElement);
        await settle();

        expect(container.querySelector('[role="status"] button')?.textContent).toContain(useLocale().t('keys.banner.absentAction'));

        setGap(null);
        await settle();

        expect(container.querySelector('[role="status"]')).toBeNull();
    });

    it('keeps its button, and whoever is on it, when the devices behind the question are read again', async () =>
    {
        useLocale().setLocale('en');
        const router = createRouter({ routes: [{ path: '/', component: () => document.createElement('div') }], history: createMemoryHistory('/'), scroll: false });
        const { container } = renderTest(() => RouterProvider({ router, children: () => KeysBanner({}) }) as HTMLElement);
        await settle();

        const button = container.querySelector<HTMLButtonElement>('[role="status"] button')!;

        button.focus();
        readAgain();
        await settle();

        expect(container.querySelector('[role="status"] button'), 'the banner was drawn again for the same answer').toBe(button);
        expect(document.activeElement).toBe(button);
    });
});
