import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { signOut } from '../src/components/app/sign-out.ts';
import { decodeKey, keepReach, leaveReach } from '../src/lib/push.ts';
import { ApiError, client, server } from './fake-api.ts';
import { fakeNotices, type FakeNotices } from './fake-notices.ts';

vi.mock('../src/api.ts', async () => await import('./fake-api.ts'));

const KEY = 'BPnJ0YVvZs7GkY7iYy5yTGmVvJ0O2m0cP0kWn0dD3mJ4qv7o3bWvX2Jm1mQe4yZ6m0qfS6rL1tV9Yx2pKc8Dd4s';

const OTHER = 'BAb5pT0rX9yQm2c1Vh8sKf3LwZ6nJ4dE7uG0iR5oP2aS9tY1qW8xC6vB3mN7kH4jF0gD5lZ2pO9iU6yT3rE1wQ8a';

let browser: FakeNotices | null = null;

const told = () => server.pushSubscriptions.map((one) => one.endpoint);

const asked = (what: string) => server.calls.filter((call) => call === `notifications.${ what }`).length;

beforeEach(() =>
{
    server.reset();
});

afterEach(() =>
{
    browser?.restore();
    browser = null;
});

describe('the reach of a device that is switched on', () =>
{
    it('is made at start where the server can push and nothing was subscribed, as when keys are set after the switch was turned on', async () =>
    {
        server.pushKey = KEY;
        browser = fakeNotices('granted', { push: true });

        await expect(keepReach(true)).resolves.toBe(true);
        expect(browser.made).toEqual(['https://push.example/1']);
        expect(told(), 'the browser was subscribed and the server never heard of it').toEqual(['https://push.example/1']);
    });

    it('is told to the server again, and not made again, when the browser already holds it', async () =>
    {
        server.pushKey = KEY;
        browser = fakeNotices('granted', { subscribed: true, madeWith: decodeKey(KEY) });

        await expect(keepReach(true)).resolves.toBe(true);
        expect(browser.made, 'a subscription that was good was made again').toHaveLength(1);
        expect(browser.left).toEqual([]);
        expect(told(), 'a row the server had lost, or kept under another account, was not put right').toEqual(['https://push.example/1']);
    });

    it('is made again when the server has changed its key, and the old one is given up on both sides', async () =>
    {
        server.pushKey = KEY;
        browser = fakeNotices('granted', { subscribed: true, madeWith: decodeKey(OTHER) });
        server.pushSubscriptions = [{ endpoint: 'https://push.example/1', p256dh: 'old', auth: 'old' }];

        await expect(keepReach(true)).resolves.toBe(true);
        expect(browser.left).toEqual(['https://push.example/1']);
        expect(browser.made).toEqual(['https://push.example/1', 'https://push.example/2']);
        expect(told()).toEqual(['https://push.example/2']);
    });

    it('is given up when the server no longer publishes a key, so the page speaks for itself', async () =>
    {
        browser = fakeNotices('granted', { subscribed: true, madeWith: decodeKey(KEY) });
        server.pushSubscriptions = [{ endpoint: 'https://push.example/1', p256dh: 'old', auth: 'old' }];

        await expect(keepReach(true)).resolves.toBe(false);
        expect(browser.subscribed()).toBe(false);
        expect(told()).toEqual([]);
    });

    it('is given up when the switch is off and the browser still holds one', async () =>
    {
        server.pushKey = KEY;
        browser = fakeNotices('granted', { subscribed: true, madeWith: decodeKey(KEY) });
        server.pushSubscriptions = [{ endpoint: 'https://push.example/1', p256dh: 'old', auth: 'old' }];

        await expect(keepReach(false)).resolves.toBe(false);
        expect(browser.subscribed()).toBe(false);
        expect(told()).toEqual([]);
        expect(asked('subscribe')).toBe(0);
        expect(asked('push-key'), 'the server was asked for a key nobody was going to use').toBe(0);
    });

    it('costs a device that is switched off and holds nothing no request at all', async () =>
    {
        server.pushKey = KEY;
        browser = fakeNotices('granted', { push: true });

        await expect(keepReach(false)).resolves.toBe(false);
        expect(server.calls.filter((call) => call.startsWith('notifications.'))).toEqual([]);
        expect(browser.made).toEqual([]);
    });

    it('is left exactly as it was when the server cannot be asked for its key', async () =>
    {
        const pushKey = client.notifications.pushKey;

        browser = fakeNotices('granted', { subscribed: true, madeWith: decodeKey(KEY) });
        client.notifications.pushKey = async () =>
        {
            throw new ApiError(503, 'unavailable', 'The server is not answering.', undefined);
        };

        try
        {
            await expect(keepReach(true), 'a server that did not answer was taken for one with no key').resolves.toBe(true);
        }
        finally
        {
            client.notifications.pushKey = pushKey;
        }

        expect(browser.left).toEqual([]);
        expect(browser.subscribed()).toBe(true);
    });

    it('is not kept at the browser when the server refuses a subscription that was just made', async () =>
    {
        const subscribe = client.notifications.subscribe;

        server.pushKey = KEY;
        browser = fakeNotices('granted', { push: true });
        client.notifications.subscribe = async () =>
        {
            throw new ApiError(503, 'unavailable', 'The server is not answering.', undefined);
        };

        try
        {
            await expect(keepReach(true)).resolves.toBe(false);
        }
        finally
        {
            client.notifications.subscribe = subscribe;
        }

        expect(browser.made).toHaveLength(1);
        expect(browser.subscribed(), 'the browser held a subscription no server knows of, and the page would wait for a push that never comes').toBe(false);
    });

    it('is kept when it was already there and the server only could not be told again', async () =>
    {
        const subscribe = client.notifications.subscribe;

        server.pushKey = KEY;
        browser = fakeNotices('granted', { subscribed: true, madeWith: decodeKey(KEY) });
        client.notifications.subscribe = async () =>
        {
            throw new ApiError(503, 'unavailable', 'The server is not answering.', undefined);
        };

        try
        {
            await expect(keepReach(true)).resolves.toBe(true);
        }
        finally
        {
            client.notifications.subscribe = subscribe;
        }

        expect(browser.left, 'one bad moment on the network cost the device its reach').toEqual([]);
    });

    it('is never asked of a browser that has not said yes, or has no push at all', async () =>
    {
        server.pushKey = KEY;
        browser = fakeNotices('default', { answer: 'granted', push: true });

        await expect(keepReach(true)).resolves.toBe(false);
        expect(browser.made, 'the browser was asked for permission at start').toEqual([]);

        browser.restore();
        browser = fakeNotices('granted');

        await expect(keepReach(true)).resolves.toBe(false);
        expect(browser.made).toEqual([]);
        expect(asked('push-key'), 'a browser with no push asked the server about one').toBe(1);
    });

    it('is given up before the session ends when the reader signs out, so the server can still be told', async () =>
    {
        const replace = vi.spyOn(window.location, 'replace').mockImplementation(() => undefined);

        browser = fakeNotices('granted', { subscribed: true, madeWith: decodeKey(KEY) });
        server.pushSubscriptions = [{ endpoint: 'https://push.example/1', p256dh: 'old', auth: 'old' }];

        try
        {
            await signOut();
        }
        finally
        {
            replace.mockRestore();
        }

        const asked = server.calls.indexOf('notifications.unsubscribe');

        expect(browser.subscribed(), 'a browser nobody is signed in on was still being pushed to').toBe(false);
        expect(told()).toEqual([]);
        expect(asked).toBeGreaterThan(-1);
        expect(asked, 'the server was told after the session had ended').toBeLessThan(server.calls.indexOf('auth.sign-out'));
    });

    it('is given up on both sides when the reader leaves', async () =>
    {
        browser = fakeNotices('granted', { subscribed: true, madeWith: decodeKey(KEY) });
        server.pushSubscriptions = [{ endpoint: 'https://push.example/1', p256dh: 'old', auth: 'old' }];

        await leaveReach();

        expect(browser.subscribed()).toBe(false);
        expect(told()).toEqual([]);

        await expect(leaveReach(), 'leaving with nothing to give up was an error').resolves.toBeUndefined();
        expect(asked('unsubscribe')).toBe(1);
    });
});
