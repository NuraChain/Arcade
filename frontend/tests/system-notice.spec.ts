import { afterEach, describe, expect, it } from 'vitest';

import { allowNotices, clearSystem, noticesAllowed, noticesBlocked, noticesSupported, tellSystem } from '../src/lib/system-notice.ts';
import { fakeNotices, type FakeNotices } from './fake-notices.ts';

const NOTICE = { title: 'Sara sent a message', tag: 'chat:c-sara', target: '/app/chats/c-sara', lang: 'en', dir: 'ltr' as const, pushed: false };

const WORKER = Object.values(import.meta.glob('../public/push-worker.js', { query: '?raw', import: 'default', eager: true }) as Record<string, string>)[0];

const SERVED = Object.keys(import.meta.glob('../public/*.{png,jpg,svg,webp}')).map((path) => path.replace('../public', ''));

let browser: FakeNotices | null = null;

afterEach(() =>
{
    browser?.restore();
    browser = null;
});

describe('a notice shown by the system', () =>
{
    it('is not offered where the browser has no notifications of its own', async () =>
    {
        expect(noticesSupported()).toBe(false);
        expect(noticesAllowed()).toBe(false);
        expect(noticesBlocked()).toBe(false);
        await expect(allowNotices()).resolves.toBe(false);
        await expect(tellSystem(NOTICE)).resolves.toBe(false);
        await expect(clearSystem()).resolves.toBeUndefined();
    });

    it('asks the browser, registers the worker it shows through, and says yes only to a yes', async () =>
    {
        browser = fakeNotices('default', { answer: 'granted', registered: false });

        expect(noticesAllowed()).toBe(false);
        await expect(allowNotices()).resolves.toBe(true);
        expect(browser.registered).toEqual(['/push-worker.js']);
        expect(noticesAllowed()).toBe(true);

        browser.restore();
        browser = fakeNotices('default', { answer: 'denied', registered: false });

        await expect(allowNotices()).resolves.toBe(false);
        expect(browser.registered, 'a worker was registered for somebody who said no').toEqual([]);
        expect(noticesBlocked()).toBe(true);
    });

    it('is shown only while nobody is looking at the page', async () =>
    {
        browser = fakeNotices('granted');

        await expect(tellSystem(NOTICE)).resolves.toBe(false);
        expect(browser.shown).toEqual([]);

        browser.hide(true);

        await expect(tellSystem(NOTICE)).resolves.toBe(true);
        expect(browser.shown).toHaveLength(1);
        expect(browser.shown[0].title).toBe('Sara sent a message');
        expect(browser.shown[0].options).toMatchObject({ tag: 'chat:c-sara', renotify: true, lang: 'en', dir: 'ltr', data: { target: '/app/chats/c-sara' } });
        expect(browser.shown[0].options.body, 'a notice carried more than its one sentence').toBeUndefined();
    });

    it('carries pictures the server really has, as the worker\'s own notice does', async () =>
    {
        browser = fakeNotices('granted');
        browser.hide(true);
        await tellSystem(NOTICE);

        const worker = [...WORKER.matchAll(/(?:icon|badge): '([^']+)'/g)].map((found) => found[1]);
        const pictures = [browser.shown[0].options.icon, browser.shown[0].options.badge, ...worker];

        expect(SERVED, 'the spec no longer finds the pictures in public/').toContain('/favicon-32.png');
        expect(pictures).toHaveLength(4);
        expect(pictures.filter((one) => one === undefined || !SERVED.includes(one)), 'a notice pointed at a picture that is not in public/').toEqual([]);
    });

    it('leaves what the server pushes to the push, on a device a push reaches, and says the rest itself', async () =>
    {
        browser = fakeNotices('granted', { subscribed: true });
        browser.hide(true);

        await expect(tellSystem({ ...NOTICE, pushed: true })).resolves.toBe(false);
        expect(browser.shown, 'the page spoke of something the push will say').toEqual([]);

        await expect(tellSystem(NOTICE)).resolves.toBe(true);
        expect(browser.shown.map((one) => one.options.tag)).toEqual(['chat:c-sara']);
    });

    it('says what the server pushes itself, on a device no push reaches', async () =>
    {
        browser = fakeNotices('granted', { push: true });
        browser.hide(true);

        await expect(tellSystem({ ...NOTICE, pushed: true })).resolves.toBe(true);
        expect(browser.shown.map((one) => one.options.tag)).toEqual(['chat:c-sara']);

        browser.restore();
        browser = fakeNotices('granted');
        browser.hide(true);

        await expect(tellSystem({ ...NOTICE, pushed: true }), 'a browser with no push at all was taken for one a push reaches').resolves.toBe(true);
    });

    it('is one notice for one subject, however often it is told', async () =>
    {
        browser = fakeNotices('granted');
        browser.hide(true);

        await tellSystem(NOTICE);
        await tellSystem({ ...NOTICE, title: '2 new messages from Sara' });
        await tellSystem({ ...NOTICE, tag: 'chat:c-omid', title: 'Omid sent a message' });

        expect(browser.shown.map((one) => one.title)).toEqual(['2 new messages from Sara', 'Omid sent a message']);
    });

    it('is not shown where the browser has not said yes, or has no worker of ours', async () =>
    {
        browser = fakeNotices('default');
        browser.hide(true);

        await expect(tellSystem(NOTICE)).resolves.toBe(false);

        browser.restore();
        browser = fakeNotices('granted', { registered: false });
        browser.hide(true);

        await expect(tellSystem(NOTICE)).resolves.toBe(false);
        expect(browser.shown).toEqual([]);
    });

    it('is taken down, every one of ours, when it is asked', async () =>
    {
        browser = fakeNotices('granted');
        browser.hide(true);
        await tellSystem(NOTICE);
        await tellSystem({ ...NOTICE, tag: 'turn:t-1', title: 'Your turn at Ludo' });

        await clearSystem();

        expect(browser.closed).toEqual(['chat:c-sara', 'turn:t-1']);
    });
});
