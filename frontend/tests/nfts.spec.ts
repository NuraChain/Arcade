import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderTest } from '@azerothjs/testing';
import { createMemoryHistory, createRouter, RouterProvider, type Route } from 'azerothjs';

import ProfileHeader from '../src/components/social/profile-header.component.azeroth';
import NftsPage from '../src/pages/app/nfts.page.azeroth';
import '../src/locales/app-catalogue.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import type { Account, NftItem } from '../../backend/src/schemas.ts';
import { server } from './fake-api.ts';

vi.mock('../src/api.ts', async () => await import('./fake-api.ts'));

const settle = async () =>
{
    for (let i = 0; i < 12; i++)
    {
        await Promise.resolve();
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
};

const COLLECTION = '0x3333333333333333333333333333333333333333';

const token = (n: number): NftItem => ({
    contract: COLLECTION,
    tokenId: String(n),
    standard: n % 2 === 0 ? 'erc721' : 'erc1155',
    amount: n % 2 === 0 ? '1' : '3',
    collection: 'Knights',
    name: n === 1 ? '' : `Knight ${ n }`,
    image: n === 2 ? '' : `/api/nfts/image/${ COLLECTION }/${ n }`
});

const signIn = () =>
{
    const account: Account = {
        id: 'u-dana',
        handle: 'dana.w',
        displayName: 'Dana',
        bio: '',
        hue: 12,
        isMinor: false,
        address: '0x1111111111111111111111111111111111111111'
    };
    server.account = account;
    useSession().establish(account);
};

const render = async (component: () => HTMLElement) =>
{
    const table: Route[] = [{ path: '/app/me/nfts', component }];
    const router = createRouter({ routes: table, history: createMemoryHistory('/app/me/nfts'), scroll: false });
    const { container } = renderTest(() => RouterProvider({ router, children: component }) as HTMLElement);
    await settle();
    return container;
};

const page = (): Promise<HTMLElement> => render(() => NftsPage({}) as unknown as HTMLElement);

beforeEach(() =>
{
    cleanup();
    useLocale().setLocale('en');
    server.reset();
});

afterEach(() =>
{
    cleanup();
});

describe('the NFT count on a profile', () =>
{
    it('links a stat that names a page, and names the link by its count and label', async () =>
    {
        const container = await render(() => ProfileHeader({
            person: { displayName: 'Dana', hue: 12, handle: 'dana.w' },
            presence: null,
            stats: [{ label: 'Friends', value: 3 }, { label: 'NFTs', value: 7, to: '/app/me/nfts' }]
        }) as unknown as HTMLElement);

        const links = [...container.querySelectorAll('dl a')];
        expect(links).toHaveLength(1);
        expect(links[0]!.getAttribute('href')).toBe('/app/me/nfts');
        expect(links[0]!.getAttribute('aria-label')).toBe('7 NFTs');
    });
});

describe('the NFT page', () =>
{
    it('shows every token the wallet holds with its name, collection and picture', async () =>
    {
        signIn();
        server.nfts = { configured: true, items: [token(1), token(2), token(4)] };

        const container = await page();
        const cards = [...container.querySelectorAll('ul > li')];

        expect(cards).toHaveLength(3);
        expect(cards[0]!.textContent).toContain('#1');
        expect(cards[0]!.textContent).toContain('3 copies');
        expect(cards[1]!.textContent).toContain('Knight 2');
        expect(cards[1]!.querySelector('img')).toBeNull();
        expect(cards[2]!.querySelector('img')?.getAttribute('src')).toBe(`/api/nfts/image/${ COLLECTION }/4`);
        expect(cards[2]!.textContent).not.toContain('copies');
    });

    it('pages through a large wallet without repeating a token', async () =>
    {
        signIn();
        server.nfts = { configured: true, items: Array.from({ length: 30 }, (_, i) => token(i + 10)) };

        const container = await page();
        expect(container.querySelectorAll('ul > li')).toHaveLength(24);

        [...container.querySelectorAll('button')].find((one) => one.textContent?.includes('Show more'))!.click();
        await settle();

        const ids = [...container.querySelectorAll('ul > li')].map((card) => card.textContent);
        expect(ids).toHaveLength(30);
        expect(new Set(ids).size).toBe(30);
        expect([...container.querySelectorAll('button')].some((one) => one.textContent?.includes('Show more'))).toBe(false);
    });

    it('keeps the tokens already shown when more are read, pictures and all', async () =>
    {
        signIn();
        server.nfts = { configured: true, items: Array.from({ length: 30 }, (_, i) => token(i + 10)) };

        const container = await page();
        const list = container.querySelector('ul');
        const shown = [...container.querySelectorAll('ul > li')];
        const picture = container.querySelector('ul img');

        expect(picture).not.toBeNull();

        [...container.querySelectorAll('button')].find((one) => one.textContent?.includes('Show more'))!.click();
        await settle();

        const after = [...container.querySelectorAll('ul > li')];

        expect(after).toHaveLength(30);
        expect(container.querySelector('ul')).toBe(list);
        expect(after.slice(0, 24)).toEqual(shown);
        expect(container.querySelector('ul img')).toBe(picture);
    });

    it('says an empty wallet is empty', async () =>
    {
        signIn();
        server.nfts = { configured: true, items: [] };

        expect((await page()).textContent).toContain('No NFTs in this wallet');
    });

    it('says so when the server reads no chain, rather than calling the wallet empty', async () =>
    {
        signIn();

        const text = (await page()).textContent ?? '';
        expect(text).toContain('does not read NFTs');
        expect(text).not.toContain('No NFTs in this wallet');
    });
});
