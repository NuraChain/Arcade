import { describe, expect, it } from 'vitest';

import { wentTo } from '../src/lib/system-notice.ts';
import { fakeWorker, tabAt } from './fake-worker.ts';

const SOURCE = Object.values(import.meta.glob('../public/push-worker.js', { query: '?raw', import: 'default', eager: true }) as Record<string, string>)[0];

const clicked = (target?: unknown) => ({ data: target === undefined ? undefined : { target } });

describe('a click on a notice', () =>
{
    it('brings the open tab forward and tells it where the notice led', async () =>
    {
        const tab = tabAt('/app');
        const worker = fakeWorker(SOURCE, [tab]);

        const notice = await worker.click(clicked('/app/chats/c-sara'));

        expect(notice.closed, 'the notice stayed on the screen after it was pressed').toBe(1);
        expect(tab.focused).toBe(1);
        expect(tab.posted.map(wentTo), 'the page was told something it would not act on').toEqual(['/app/chats/c-sara']);
        expect(worker.opened).toEqual([]);
    });

    it('takes any page of the app for a tab inside it, the home page with or without a query as well', async () =>
    {
        for (const place of ['/app', '/app?welcome=1', '/app/games', '/app/me/settings'])
        {
            const tab = tabAt(place);
            const worker = fakeWorker(SOURCE, [tab]);

            await worker.click(clicked('/app/chats/c-sara'));

            expect(tab.focused, `a tab at ${ place } was passed over`).toBe(1);
            expect(tab.posted.map(wentTo)).toEqual(['/app/chats/c-sara']);
            expect(worker.opened).toEqual([]);
        }
    });

    it('brings forward the tab that already shows it, and sends that tab nowhere', async () =>
    {
        const other = tabAt('/app');
        const there = tabAt('/app/friends?tab=requests');
        const worker = fakeWorker(SOURCE, [other, there]);

        await worker.click(clicked('/app/friends?tab=requests'));

        expect(there.focused).toBe(1);
        expect(there.posted).toEqual([]);
        expect(other.focused).toBe(0);
        expect(other.posted).toEqual([]);
        expect(worker.opened).toEqual([]);
    });

    it('opens the thing itself when no tab is inside the app, whatever else of ours is open', async () =>
    {
        const outside = [tabAt('/'), tabAt('/sign-in'), tabAt('/apps'), tabAt('/application/play')];
        const worker = fakeWorker(SOURCE, outside);

        await worker.click(clicked('/app/play/t-9'));

        expect(worker.opened).toEqual(['/app/play/t-9']);
        expect(outside.map((tab) => tab.focused)).toEqual([0, 0, 0, 0]);
        expect(outside.flatMap((tab) => tab.posted)).toEqual([]);

        const alone = fakeWorker(SOURCE, []);

        await alone.click(clicked('/app/play/t-9'));

        expect(alone.opened).toEqual(['/app/play/t-9']);
    });

    it('opens the thing itself when the tab went away while it was being brought forward', async () =>
    {
        const gone = tabAt('/app', { gone: true });
        const worker = fakeWorker(SOURCE, [gone]);

        await worker.click(clicked('/app/chats/c-sara'));

        expect(worker.opened).toEqual(['/app/chats/c-sara']);
        expect(gone.posted).toEqual([]);
    });

    it('leads to the list when the notice says nowhere, or anywhere outside the app', async () =>
    {
        for (const target of [undefined, 7, ['/app/games'], '', '/', '/app', '/sign-in', '//elsewhere.example/app/', 'https://elsewhere.example/app/games'])
        {
            const tab = tabAt('/app');
            const worker = fakeWorker(SOURCE, [tab]);

            await worker.click(clicked(target));

            expect(tab.posted.map(wentTo), `a notice that led to ${ String(target) }`).toEqual(['/app/notifications']);
        }
    });
});

describe('a new worker', () =>
{
    it('takes over as soon as it is installed, without waiting for every tab to be closed', async () =>
    {
        const worker = fakeWorker(SOURCE, [tabAt('/app')]);

        expect(await worker.install()).toBe(1);
    });
});
