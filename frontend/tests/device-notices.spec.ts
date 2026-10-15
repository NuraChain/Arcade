import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderTest } from '@azerothjs/testing';

import DeviceNotices from '../src/components/app/device-notices.component.azeroth';
import '../src/locales/app-catalogue.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useSettings } from '../src/stores/settings.store.ts';
import { useToasts } from '../src/stores/toasts.store.ts';
import { client, server } from './fake-api.ts';
import { fakeNotices, type FakeNotices } from './fake-notices.ts';

vi.mock('../src/api.ts', async () => await import('./fake-api.ts'));

let browser: FakeNotices | null = null;

const settle = async () =>
{
    for (let turn = 0; turn < 12; turn += 1)
    {
        await Promise.resolve();
    }

    await new Promise((resolve) => setTimeout(resolve, 20));
};

const shown = async () =>
{
    const { container } = renderTest(() => DeviceNotices() as HTMLElement);

    await settle();

    return container;
};

const button = (container: HTMLElement, name: string) => [...container.querySelectorAll('button')].find((one) => one.textContent?.trim() === name);

beforeEach(() =>
{
    cleanup();
    server.reset();
    useLocale().setLocale('en');
    useSettings().reset();
});

afterEach(() =>
{
    cleanup();
    browser?.restore();
    browser = null;
    useSettings().reset();
});

describe('the switch for notifications on this device', () =>
{
    it('is not drawn in a browser that has no notifications', async () =>
    {
        const container = await shown();

        expect(container.textContent).toBe('');
    });

    it('offers to be turned on on a server with no push keys, and says the page has to stay open', async () =>
    {
        browser = fakeNotices('default', { answer: 'granted', registered: false });

        const container = await shown();

        expect(container.textContent).toContain('Notifications on this device');
        expect(button(container, 'Turn on for this device')).toBeDefined();

        button(container, 'Turn on for this device')!.click();
        await settle();

        expect(useSettings().settings().notify).toBe(true);
        expect(browser.registered).toEqual(['/push-worker.js']);
        expect(container.textContent).toContain('On for this device');
        expect(container.textContent).toContain('While Nura Games is open in a tab.');
        expect(server.calls, 'a server with no push keys was sent a subscription').not.toContain('notifications.subscribe');
        expect(button(container, 'Turn on for this device')).toBeUndefined();
    });

    it('subscribes as well where the server can push, and says it reaches a closed page', async () =>
    {
        server.pushKey = 'BPnJ0YVvZs7GkY7iYy5yTGmVvJ0O2m0cP0kWn0dD3mJ4qv7o3bWvX2Jm1mQe4yZ6m0qfS6rL1tV9Yx2pKc8Dd4s';
        browser = fakeNotices('default', { answer: 'granted', registered: false, push: true });

        const container = await shown();

        button(container, 'Turn on for this device')!.click();
        await settle();

        expect(server.calls).toContain('notifications.subscribe');
        expect(browser.subscribed()).toBe(true);
        expect(container.textContent).toContain('Also when Nura Games is closed.');
    });

    it('is on for the open page all the same when the browser will not subscribe, with no complaint', async () =>
    {
        server.pushKey = 'BPnJ0YVvZs7GkY7iYy5yTGmVvJ0O2m0cP0kWn0dD3mJ4qv7o3bWvX2Jm1mQe4yZ6m0qfS6rL1tV9Yx2pKc8Dd4s';
        browser = fakeNotices('default', { answer: 'granted', registered: false, push: true, pushFails: true });
        useToasts().reset();

        const container = await shown();

        button(container, 'Turn on for this device')!.click();
        await settle();

        expect(useSettings().settings().notify).toBe(true);
        expect(container.textContent).toContain('On for this device');
        expect(container.textContent).toContain('While Nura Games is open in a tab.');
        expect(server.calls).not.toContain('notifications.subscribe');
        expect(useToasts().items()).toHaveLength(0);
    });

    it('lets go of a subscription the server could not be told about, and says the page has to stay open', async () =>
    {
        const told = client.notifications.subscribe;

        server.pushKey = 'BPnJ0YVvZs7GkY7iYy5yTGmVvJ0O2m0cP0kWn0dD3mJ4qv7o3bWvX2Jm1mQe4yZ6m0qfS6rL1tV9Yx2pKc8Dd4s';
        browser = fakeNotices('default', { answer: 'granted', registered: false, push: true });
        client.notifications.subscribe = async () =>
        {
            throw new Error('the server is not answering');
        };

        try
        {
            const container = await shown();

            button(container, 'Turn on for this device')!.click();
            await settle();

            expect(browser.subscribed(), 'the browser kept a subscription no server knows of').toBe(false);
            expect(container.textContent).toContain('While Nura Games is open in a tab.');
            expect(useSettings().settings().notify).toBe(true);
        }
        finally
        {
            client.notifications.subscribe = told;
        }
    });

    it('stays off, and says why, when the browser is asked and says no', async () =>
    {
        browser = fakeNotices('default', { answer: 'denied', registered: false });

        const container = await shown();

        button(container, 'Turn on for this device')!.click();
        await settle();

        expect(useSettings().settings().notify).toBe(false);
        expect(container.textContent).toContain('This browser is blocking notifications.');
        expect(button(container, 'Turn on for this device')).toBeUndefined();
        expect(browser.registered).toEqual([]);
    });

    it('is on when it was turned on before and the browser still allows it, and off when the browser no longer does', async () =>
    {
        useSettings().update({ notify: true });
        browser = fakeNotices('granted');

        expect((await shown()).textContent).toContain('On for this device');

        cleanup();
        browser.restore();
        browser = fakeNotices('default');

        const container = await shown();

        expect(container.textContent).not.toContain('On for this device');
        expect(button(container, 'Turn on for this device')).toBeDefined();
    });

    it('is turned off here and at the server, which is told to stop knocking', async () =>
    {
        server.pushKey = 'BPnJ0YVvZs7GkY7iYy5yTGmVvJ0O2m0cP0kWn0dD3mJ4qv7o3bWvX2Jm1mQe4yZ6m0qfS6rL1tV9Yx2pKc8Dd4s';
        browser = fakeNotices('default', { answer: 'granted', registered: false, push: true });

        const container = await shown();

        button(container, 'Turn on for this device')!.click();
        await settle();
        button(container, 'Turn off for this device')!.click();
        await settle();

        expect(useSettings().settings().notify).toBe(false);
        expect(server.calls).toContain('notifications.unsubscribe');
        expect(browser.subscribed()).toBe(false);
        expect(button(container, 'Turn on for this device')).toBeDefined();
    });

    it('reads in Persian', async () =>
    {
        useLocale().setLocale('fa');
        browser = fakeNotices('default');

        const container = await shown();

        expect(container.textContent).toContain('اعلان‌ها روی این دستگاه');
        expect(button(container, 'واسه این دستگاه روشنش کن')).toBeDefined();
    });
});
