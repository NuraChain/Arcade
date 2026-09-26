import { describe, it, expect, afterEach, vi } from 'vitest';
import { RouterProvider, createMemoryHistory, createRouter } from 'azerothjs';
import { cleanup, renderTest } from '@azerothjs/testing';

import KeysBanner from '../src/components/app/keys-banner.component.azeroth';
import '../src/locales/app-catalogue.ts';
import * as enrolment from '../src/stores/enrolment.store.ts';
import { useLocale } from '../src/stores/locale.store.ts';

type Gap = 'absent' | 'waiting' | null;

vi.mock('../src/stores/enrolment.store.ts', async () =>
{
    const { createSignal } = await import('azerothjs');
    const [gap, setGap] = createSignal<Gap>('absent');

    return {
        setGap,
        useEnrolment: () => ({
            gap,
            asking: () => gap() !== null,
            dismiss: () => undefined,
            give: async () => undefined
        })
    };
});

vi.mock('../src/api.ts', async () => await import('./fake-api.ts'));

const setGap = (enrolment as unknown as { setGap: (value: Gap) => void }).setGap;

const settle = async (): Promise<void> =>
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
    it('follows the gap from a button to a link, and leaves without throwing when it closes', async () =>
    {
        useLocale().setLocale('en');
        const router = createRouter({ routes: [{ path: '/', component: () => document.createElement('div') }], history: createMemoryHistory('/'), scroll: false });
        const { container } = renderTest(() => RouterProvider({ router, children: () => KeysBanner({}) }) as HTMLElement);
        await settle();

        expect(container.querySelector('[role="status"] button')?.textContent).toContain(useLocale().t('keys.banner.absentAction'));

        setGap('waiting');
        await settle();

        expect(container.querySelector('a[href="/app/me/devices"]')).not.toBeNull();
        expect(container.textContent).toContain(useLocale().t('keys.banner.waiting'));

        setGap(null);
        await settle();

        expect(container.querySelector('[role="status"]')).toBeNull();
    });
});
