import { describe, expect, it } from 'vitest';

import type { Notification } from '../src/api.ts';
import { WORDS, wordsOf } from '../src/lib/notice-words.ts';
import { wentTo } from '../src/lib/system-notice.ts';
import { fakeWorker, Refused, tabAt, type WorkerNotice } from './fake-worker.ts';
import { PEOPLE_FIXTURES } from './fixtures.ts';
import '../src/locales/app-catalogue.ts';

const SOURCE = Object.values(import.meta.glob('../public/push-worker.js', { query: '?raw', import: 'default', eager: true }) as Record<string, string>)[0];

const SERVED = Object.keys(import.meta.glob('../public/*.{png,jpg,svg,webp}')).map((path) => path.replace('../public', ''));

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

describe('a push', () =>
{
    const LISTED = '/api/notifications/';

    const GENERAL = 'Something new in Nura Games';

    const at = (minute: number) => new Date(Date.UTC(2026, 9, 12, 10, minute)).toISOString();

    const row = (id: string, minute: number, more: Partial<Notification> = {}): Notification => ({
        id,
        kind: 'table-invite',
        actor: 'sara.k',
        ref: { tableId: `t-${ id }` },
        count: 1,
        at: at(minute),
        read: false,
        ...more
    });

    const world = (rows: Notification[] | Refused, words: object | null = wordsOf('en')) => ({
        kept: new Map<string, string>(words === null ? [] : [[WORDS, JSON.stringify(words)]]),

        answer: (url: string) =>
        {
            if (url === LISTED)
            {
                if (rows instanceof Refused)
                {
                    throw rows;
                }

                return { items: rows, hasMore: false, unread: rows.filter((one) => !one.read).length };
            }

            if (url.startsWith('/api/social/names?handles='))
            {
                const handles = decodeURIComponent(url.slice(url.indexOf('=') + 1)).split(',');

                return { people: PEOPLE_FIXTURES.filter((one) => handles.includes(one.handle)) };
            }

            return undefined;
        }
    });

    const said = (notices: WorkerNotice[]) => notices.map((one) => one.title);

    const tags = (notices: WorkerNotice[]) => notices.map((one) => one.options.tag);

    it('says what happened, names whoever did it, and leads to the thing', async () =>
    {
        const worker = fakeWorker(SOURCE, [], world([row('a', 5)]));

        const [notice] = await worker.push();

        expect(notice.title).toBe('Sara Kamali saved you a seat');
        expect(notice.options).toMatchObject({
            tag: 'table-invite:t-a',
            renotify: true,
            lang: 'en',
            dir: 'ltr',
            data: { target: '/app/play/t-a' }
        });
        expect(notice.options.body, 'a notice carried more than its one sentence').toBeUndefined();
        expect(SERVED).toContain(notice.options.icon);
        expect(SERVED).toContain(notice.options.badge);
    });

    it('says it in the language the page last kept, right to left when that language is', async () =>
    {
        const worker = fakeWorker(SOURCE, [], world([row('a', 5)], wordsOf('fa')));

        const [notice] = await worker.push();

        expect(notice.title).toBe('Sara Kamali یک صندلی برایت نگه داشت');
        expect(notice.options).toMatchObject({ lang: 'fa', dir: 'rtl' });
    });

    it('says nothing while a page inside the app is being looked at, and does not say it afterwards either', async () =>
    {
        const tab = tabAt('/app');
        const worker = fakeWorker(SOURCE, [tab], world([row('a', 5)]));

        expect(await worker.push()).toEqual([]);

        tab.visibilityState = 'hidden';

        const later = await worker.push();

        expect(said(later), 'what the page had already shown was said again').toEqual([GENERAL]);
        expect(later[0].options).toMatchObject({ silent: true, renotify: false });
    });

    it('is not hushed by a page of ours outside the app, or by a tab that is hidden', async () =>
    {
        const worker = fakeWorker(SOURCE, [tabAt('/'), tabAt('/app/games', { hidden: true })], world([row('a', 5)]));

        expect(said(await worker.push())).toEqual(['Sara Kamali saved you a seat']);
    });

    it('says only the newest the first time, then everything new since, oldest first and three at most', async () =>
    {
        const rows = [row('c', 7), row('b', 6), row('a', 5)];
        const worker = fakeWorker(SOURCE, [], world(rows));

        expect(tags(await worker.push())).toEqual(['table-invite:t-c']);
        expect(said(await worker.push()), 'rows older than the one it said were taken for new').toEqual([GENERAL]);

        rows.unshift(row('h', 12), row('g', 11), row('f', 10), row('e', 9), row('d', 8, { read: true }));

        expect(tags(await worker.push())).toEqual(['table-invite:t-f', 'table-invite:t-g', 'table-invite:t-h']);
    });

    it('says a row again when it has happened again, and never one that was read', async () =>
    {
        const rows = [row('a', 5, { kind: 'message', actor: 'reza.t', ref: { conversationId: 'c-reza' } })];
        const worker = fakeWorker(SOURCE, [], world(rows));

        expect(said(await worker.push())).toEqual(['Reza Tehrani sent a message']);

        rows[0] = { ...rows[0], at: at(9), count: 2 };

        const again = await worker.push();

        expect(said(again)).toEqual(['Reza Tehrani sent a message']);
        expect(again[0].options).toMatchObject({ tag: 'chat:c-reza', renotify: true });

        rows[0] = { ...rows[0], at: at(11), count: 3, read: true };

        expect(said(await worker.push())).toEqual([GENERAL]);
    });

    it('says something happened, aloud, when it cannot read what', async () =>
    {
        for (const refusal of [new Refused(401), new Refused(503)])
        {
            const worker = fakeWorker(SOURCE, [], world(refusal, wordsOf('fa')));

            const [notice] = await worker.push();

            expect(notice.title).toBe(wordsOf('fa').general);
            expect(notice.title).not.toBe(GENERAL);
            expect(notice.options).toMatchObject({ tag: 'nura-games', renotify: true, silent: false, lang: 'fa', dir: 'rtl', data: { target: '/app/notifications' } });
        }
    });

    it('says something happened in plain English when the page never kept its words', async () =>
    {
        const worker = fakeWorker(SOURCE, [], world([row('a', 5)], null));

        const [notice] = await worker.push();

        expect(notice.title).toBe(GENERAL);
        expect(notice.options).toMatchObject({ renotify: true, silent: false, lang: 'en', dir: 'ltr' });
    });

    it('says something happened in plain English when what the page kept is of no use to it', async () =>
    {
        const half = fakeWorker(SOURCE, [], world([row('a', 5)], { lang: 'fa', dir: 'rtl' }));
        const [spoken] = await half.push();

        expect(spoken.title, 'words kept by another build, with a part missing, were taken whole').toBe(GENERAL);
        expect(spoken.options).toMatchObject({ renotify: true, silent: false, lang: 'fa', dir: 'rtl' });

        const broken = fakeWorker(SOURCE, [], world([row('a', 5)], { says: null }));
        const [last] = await broken.push();

        expect(last.title, 'a push ended with nothing shown').toBe(GENERAL);
        expect(last.options).toMatchObject({ tag: 'nura-games', renotify: true, silent: false, lang: 'en', dir: 'ltr', data: { target: '/app/notifications' } });
    });

    it('says something happened beside what it can say, when one of the rows is of a kind it has no words for', async () =>
    {
        const words = wordsOf('en');
        const rows = [row('a', 5)];
        const worker = fakeWorker(SOURCE, [], world(rows, { ...words, says: { ...words.says, 'group-added': undefined } }));

        await worker.push();
        rows.unshift(row('c', 7), row('b', 6, { kind: 'group-added', ref: { groupId: 'g-1' } }));

        const told = await worker.push();

        expect(said(told).sort()).toEqual([GENERAL, 'Sara Kamali saved you a seat'].sort());
        expect(told.find((one) => one.title === GENERAL)?.options).toMatchObject({ renotify: true, silent: false });
    });

    it('fills a sentence that has plural forms the way the page would, with the language\'s own digits', async () =>
    {
        const forms = { one: '{who}: {count} message', other: '{who}: {count} messages' };
        const rows = [row('a', 5, { kind: 'message', actor: 'reza.t', ref: { conversationId: 'c-reza' }, count: 1 })];
        const english = fakeWorker(SOURCE, [], world(rows, { ...wordsOf('en'), says: { ...wordsOf('en').says, message: forms } }));

        expect(said(await english.push())).toEqual(['Reza Tehrani: 1 message']);

        rows[0] = { ...rows[0], at: at(9), count: 1200 };

        expect(said(await english.push())).toEqual(['Reza Tehrani: 1,200 messages']);

        const persian = fakeWorker(SOURCE, [], world(rows, { ...wordsOf('fa'), says: { ...wordsOf('fa').says, message: forms } }));

        expect(said(await persian.push())).toEqual([`Reza Tehrani: ${ new Intl.NumberFormat('fa-IR').format(1200) } messages`]);
    });

    it('leaves a word it was given no value for as it stands, as the page does', async () =>
    {
        const worker = fakeWorker(SOURCE, [], world([row('a', 5)], { ...wordsOf('en'), says: { ...wordsOf('en').says, 'table-invite': '{who} kept {what} for you' } }));

        expect(said(await worker.push())).toEqual(['Sara Kamali kept {what} for you']);
    });

    it('calls whoever did it by their handle when nobody will say who they are', async () =>
    {
        const worker = fakeWorker(SOURCE, [], world([row('a', 5, { actor: 'nobody.at.all' })]));

        expect(said(await worker.push())).toEqual(['nobody.at.all saved you a seat']);
    });

    it('still says it, by handle, when the name cannot be read at all', async () =>
    {
        const reading = world([row('a', 5)]);

        const worker = fakeWorker(SOURCE, [], {
            ...reading,

            answer: (url) =>
            {
                if (url.startsWith('/api/social/names'))
                {
                    throw new Refused(503);
                }

                return reading.answer(url);
            }
        });

        expect(said(await worker.push())).toEqual(['sara.k saved you a seat']);
    });

    it('asks who everybody is in one request', async () =>
    {
        const rows = [row('a', 5)];
        const worker = fakeWorker(SOURCE, [], world(rows));

        await worker.push();
        rows.unshift(row('c', 7, { actor: 'reza.t' }), row('b', 6, { actor: 'mina' }));
        worker.asked.length = 0;

        expect(said(await worker.push())).toEqual(['Mina Sadeghi saved you a seat', 'Reza Tehrani saved you a seat']);
        expect(worker.asked.filter((url) => url.startsWith('/api/social/names'))).toHaveLength(1);
    });

    it('says a row with nobody in it without asking who nobody is', async () =>
    {
        const worker = fakeWorker(SOURCE, [], world([row('a', 5, { kind: 'turn', actor: undefined, ref: { tableId: 't-a', game: 'backgammon' } })]));

        const [notice] = await worker.push();

        expect(notice.title).toBe('Your turn at Backgammon');
        expect(notice.options).toMatchObject({ tag: 'turn:t-a', data: { target: '/app/play/t-a' } });
        expect(worker.asked).toEqual([LISTED]);
    });
});
