/**
 * Two people, two browsers, one server: friends, chat and groups end to end.
 *
 *   npm run build && API_RATE_MAX=20000 SERVE_PAGES=true NODE_ENV=production npm start
 *   node tools/qa/social-pass.mjs
 *
 * Everything else that drives a browser here tests ONE session. The interesting half of a social
 * product is the other side: a request somebody has to accept, a message somebody else has to be
 * able to open, a group somebody else has to be able to see. None of that is reachable from one
 * context, and none of it is reachable from a unit test either - `fake-api.ts` is one browser's
 * idea of a server, so a spec can only ever prove that this browser agrees with itself.
 *
 * The sealed half is the reason this exists. Two contexts generate two INDEPENDENT P-256 keyrings
 * in two IndexedDBs, enrol them against two different wallets, and then one of them wraps an epoch
 * key to the other and the other opens it. If that works, `nura-e2ee/v1` works between strangers;
 * if it is faked anywhere, it does not.
 *
 * Both wallets are injected EIP-1193 providers over the published hardhat keys, the same shape
 * `seal-pass.mjs` uses, so every signature is real and this server verifies them normally.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { privateKeyToAccount } from 'viem/accounts';

const BASE = process.env.QA_BASE ?? 'http://localhost:3200';

/**
 * Two accounts the seed does NOT make friends, which is what leaves a friend request testable.
 * `dana.w` is the one fixture with no device of its own; `mina` has one whose private half nobody
 * holds, so the reset below takes it away and this browser enrols the first one it can use.
 */
const ALICE = {
    handle: 'dana.w',
    name: 'Dana Whitfield',
    key: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
};
const BOB = {
    handle: 'mina',
    name: 'Mina Sadeghi',
    key: '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a'
};

const GROUP_NAME = 'Tuesday Backgammon';

function cachedChromium()
{
    const home = process.env.LOCALAPPDATA ?? process.env.HOME ?? '';
    const cache = process.env.PLAYWRIGHT_BROWSERS_PATH ?? join(home, 'ms-playwright');
    if (!existsSync(cache)) { return undefined; }
    const builds = readdirSync(cache).filter((n) => /^chromium-\d+$/.test(n))
        .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
    for (const build of builds)
    {
        for (const rel of ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe', 'chrome-linux/chrome'])
        {
            const candidate = join(cache, build, rel);
            if (existsSync(candidate)) { return candidate; }
        }
    }
    return undefined;
}

const sql = (text) => execFileSync(
    'psql',
    ['-U', 'postgres', '-h', '127.0.0.1', '-d', process.env.PGDATABASE ?? 'nura_games', '-qtA', '-c', text],
    { env: { ...process.env, PGPASSWORD: process.env.PGPASSWORD ?? 'root' }, encoding: 'utf8' }
).trim();

/**
 * Puts the two accounts back to "two strangers with no keys".
 *
 * Every fresh context has an empty keyring, so it always enrols. That has to be the account's
 * FIRST device or it arrives `pending` - confirmable only by a device whose keys nobody holds -
 * and a pending device cannot be sealed to, which would look exactly like the feature being broken.
 */
function reset()
{
    const both = `('${ ALICE.handle }', '${ BOB.handle }')`;
    sql([
        // Epochs first: they reference the devices that are about to go.
        'delete from conversation_epochs',
        "delete from messages where kind = 'text'",
        `delete from epoch_archive where user_id in (select id from users where handle in ${ both })`,
        `delete from recovery_vaults where user_id in (select id from users where handle in ${ both })`,
        `delete from devices where user_id in (select id from users where handle in ${ both })`,

        // Two strangers again.
        `delete from friendships where user_id in (select id from users where handle in ${ both })
           and friend_id in (select id from users where handle in ${ both })`,
        `delete from friend_requests where from_user in (select id from users where handle in ${ both })
           and to_user in (select id from users where handle in ${ both })`,

        // Any direct thread between them, so "Message" has to create one.
        `delete from messages where conversation_id in (
            select c.id from conversations c where c.kind = 'direct'
              and (select count(*) from conversation_members m
                    join users u on u.id = m.user_id
                   where m.conversation_id = c.id and u.handle in ${ both }) = 2)`,
        `delete from conversation_members where conversation_id in (
            select c.id from conversations c where c.kind = 'direct'
              and (select count(*) from conversation_members m
                    join users u on u.id = m.user_id
                   where m.conversation_id = c.id and u.handle in ${ both }) = 2)`,
        `delete from conversations where kind = 'direct' and id not in (select conversation_id from conversation_members)`,

        // Groups a previous run of this pass made.
        `delete from messages where conversation_id in (select id from conversations where group_id in (select id from groups where name = '${ GROUP_NAME }'))`,
        `delete from conversation_members where conversation_id in (select id from conversations where group_id in (select id from groups where name = '${ GROUP_NAME }'))`,
        `delete from conversations where group_id in (select id from groups where name = '${ GROUP_NAME }')`,
        `delete from group_members where group_id in (select id from groups where name = '${ GROUP_NAME }')`,
        `delete from groups where name = '${ GROUP_NAME }'`
    ].join('; '));
}

const results = [];
let current = '';
const section = (name) =>
{
    current = name;
    console.log(`\n[${ name }]`);
};
const record = (name, ok, detail = '') =>
{
    results.push({ section: current, name, ok, detail });
    console.log(`  ${ ok ? 'PASS' : 'FAIL' }  ${ name }${ detail ? ' — ' + detail : '' }`);
};

/**
 * `SHOW=1` opens both browsers on screen, slows every step down enough to follow, and records a
 * video per person into tools/qa/out/social. Watching it is the only way to see the two halves
 * happen at once - the log can say Mina opened the message, but not what it looked like.
 */
const SHOW = process.env.SHOW === '1';
const VIDEO_DIR = join('tools', 'qa', 'out', 'social');

const browser = await chromium.launch((() =>
{
    const path = cachedChromium();
    const options = { headless: !SHOW, slowMo: SHOW ? 180 : 0 };
    return path === undefined ? options : { ...options, executablePath: path };
})());

/** Waits for words to show up, rather than guessing how long a round trip plus a decrypt takes. */
const waitForText = async (page, needle, ms = 30000) =>
{
    const deadline = Date.now() + ms;
    while (Date.now() < deadline)
    {
        const text = await page.locator('body').innerText().catch(() => '');
        if (text.includes(needle))
        {
            return true;
        }
        await page.waitForTimeout(600);
    }
    return false;
};

/**
 * The same, but willing to reload.
 *
 * A message sent in the OTHER browser reaches this one through the realtime doorbell, and if that
 * frame is missed there is nothing else to prompt a refetch. Reloading is what a person would do,
 * and it is the honest thing for a test to do too - it proves the message is readable, which is the
 * claim, rather than proving the nudge arrived, which is a different one.
 */
const waitForTextReloading = async (page, needle, tries = 3) =>
{
    for (let attempt = 0; attempt < tries; attempt++)
    {
        if (await waitForText(page, needle, 12000))
        {
            return true;
        }
        await page.reload({ waitUntil: 'networkidle' }).catch(() => {});
        await page.waitForTimeout(2500);
    }
    return await waitForText(page, needle, 8000);
};

/** A signed-in browser for one account, with its own wallet and its own keyring. */
async function asPerson(person)
{
    const wallet = privateKeyToAccount(person.key);
    const context = await browser.newContext({
        viewport: { width: 1280, height: 900 },
        locale: 'en-US',
        recordVideo: SHOW ? { dir: VIDEO_DIR, size: { width: 1280, height: 900 } } : undefined
    });

    await context.addInitScript(() =>
    {
        try
        {
            localStorage.setItem('nura-games.theme', 'dark');
            localStorage.setItem('nura-games.locale', 'en');
        }
        catch { /* a refused store is a state the product handles */ }

        const provider = {
            isNuraTest: true,
            async request({ method, params })
            {
                if (method === 'eth_requestAccounts' || method === 'eth_accounts') { return [window.__walletAddress]; }
                if (method === 'eth_chainId') { return '0x1'; }
                if (method === 'personal_sign') { return window.__walletSign(params[0]); }
                if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') { return null; }
                throw Object.assign(new Error(`unsupported ${ method }`), { code: 4200 });
            },
            on() {},
            removeListener() {}
        };
        window.ethereum = provider;
        const announce = () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
            detail: { info: { uuid: 'nura-test', name: 'MetaMask', icon: '', rdns: 'io.metamask' }, provider }
        }));
        window.addEventListener('eip6963:requestProvider', announce);
        announce();
    });
    await context.addInitScript((address) => { window.__walletAddress = address; }, wallet.address);
    await context.exposeFunction('__walletSign', (message) => wallet.signMessage({ message }));

    const page = await context.newPage();
    const errors = [];
    page.on('console', (e) =>
    {
        if (e.type() === 'error' && !e.text().includes('favicon'))
        {
            errors.push(e.text().slice(0, 180));
        }
    });
    page.on('pageerror', (e) => errors.push(String(e).slice(0, 180)));

    await page.goto(`${ BASE }/sign-in`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: /^Connect/ }).first().click();
    await page.waitForURL(/\/app/, { timeout: 30000 });

    return { person, context, page, errors, address: wallet.address };
}

/** Gives this browser its keys. The account's first device is confirmed at birth. */
async function enrol(who)
{
    await who.page.goto(`${ BASE }/app/me/devices`, { waitUntil: 'networkidle' });
    await who.page.waitForTimeout(1200);
    const button = who.page.getByRole('button', { name: /Give this browser keys/i }).first();
    if (await button.count() === 0)
    {
        return false;
    }
    await button.click();
    await who.page.waitForTimeout(3500);
    const text = await who.page.locator('body').innerText();
    return /This browser is set up|This one/i.test(text);
}

const body = (page) => page.locator('body').innerText();

try
{
    console.log('resetting the two accounts to strangers with no keys...');
    reset();

    // ---------------------------------------------------------------- sign in and enrol
    section('two browsers, two wallets');
    const alice = await asPerson(ALICE);
    record('Dana signs in with her wallet', alice.page.url().includes('/app'), alice.address);
    const bob = await asPerson(BOB);
    record('Mina signs in with her wallet', bob.page.url().includes('/app'), bob.address);
    record('they are different accounts', alice.address !== bob.address, '');

    record('Dana gives her browser keys', await enrol(alice), '');
    record('Mina gives her browser keys', await enrol(bob), '');

    const deviceCount = sql(`select count(*) from devices d join users u on u.id = d.user_id
        where u.handle in ('${ ALICE.handle }', '${ BOB.handle }') and d.confirmed_at is not null and d.revoked_at is null`);
    record('both devices are confirmed and wallet-attested', deviceCount === '2', `${ deviceCount } confirmed`);

    // ---------------------------------------------------------------- add friend
    section('add friend');
    await alice.page.goto(`${ BASE }/app/people/${ BOB.handle }`, { waitUntil: 'networkidle' });
    await alice.page.waitForTimeout(1500);
    record('Dana can open Mina’s profile', (await body(alice.page)).includes(BOB.name), '');

    const add = alice.page.getByRole('button', { name: /^Add friend$/ }).first();
    record('a stranger is offered "Add friend"', await add.count() > 0, '');
    await add.click();
    await alice.page.waitForTimeout(2000);
    record('Dana sees the request was sent', /Request sent/i.test(await body(alice.page)), '');

    const pending = sql(`select count(*) from friend_requests r
        join users f on f.id = r.from_user join users t on t.id = r.to_user
        where f.handle = '${ ALICE.handle }' and t.handle = '${ BOB.handle }'`);
    record('the server recorded one pending request', pending === '1', `${ pending } rows`);

    await bob.page.goto(`${ BASE }/app/friends`, { waitUntil: 'networkidle' });
    await bob.page.waitForTimeout(2000);
    // A tab's accessible name carries its count with no separator - "Requests1" - so match on the
    // start of the text rather than on the whole name, and check the tab really did become current.
    const requestsTab = bob.page.locator('[role="tab"]').filter({ hasText: /^Requests/ }).first();
    record('the Requests tab counts the waiting request',
        /Requests\s*1/.test((await requestsTab.textContent()) ?? ''), (await requestsTab.textContent()) ?? '');
    await requestsTab.click();
    await bob.page.waitForTimeout(2200);
    record('the Requests tab is the one showing',
        (await requestsTab.getAttribute('aria-selected')) === 'true',
        `aria-selected=${ await requestsTab.getAttribute('aria-selected') }`);
    const incoming = await body(bob.page);
    // Mina's browser may only know Dana by HANDLE: `people.store` holds what the server has said,
    // and a handle nobody has described renders as the handle rather than as a name.
    const namesDana = incoming.includes(ALICE.name) || incoming.includes(ALICE.handle);
    record('Mina sees an incoming request', /Wants to be friends/i.test(incoming) && namesDana,
        /Wants to be friends/i.test(incoming) ? '' : 'tab shows: ' + incoming.replace(/\n+/g, ' | ').slice(0, 220));

    const buttons = [];
    for (const b of (await bob.page.locator('button').all()).slice(0, 30))
    {
        const label = ((await b.textContent()) || '').trim();
        if (label) { buttons.push(label.slice(0, 24)); }
    }
    const accept = bob.page.getByRole('button', { name: /^Accept$/ }).first();
    if (await accept.count() === 0)
    {
        record('an Accept control is offered', false, 'buttons on the page: ' + buttons.join(' / ').slice(0, 240));
        throw new Error('no Accept control');
    }
    await accept.click();
    await bob.page.waitForTimeout(2500);

    const friends = sql(`select count(*) from friendships f
        join users a on a.id = f.user_id join users b on b.id = f.friend_id
        where a.handle in ('${ ALICE.handle }', '${ BOB.handle }') and b.handle in ('${ ALICE.handle }', '${ BOB.handle }')`);
    record('the friendship is mirrored — two rows, one for each side', friends === '2', `${ friends } rows`);

    await alice.page.goto(`${ BASE }/app/friends`, { waitUntil: 'networkidle' });
    await alice.page.waitForTimeout(2000);
    record('Dana now lists Mina as a friend', (await body(alice.page)).includes(BOB.name), '');

    // ---------------------------------------------------------------- sealed direct chat
    section('a sealed conversation between two browsers');
    await alice.page.goto(`${ BASE }/app/people/${ BOB.handle }`, { waitUntil: 'networkidle' });
    await alice.page.waitForTimeout(1500);
    await alice.page.getByRole('button', { name: /^Message$/ }).first().click();
    await alice.page.waitForURL(/\/app\/chats\/[0-9a-f-]+/, { timeout: 20000 });
    const threadUrl = alice.page.url();
    record('"Message" opens a direct thread', /\/app\/chats\//.test(threadUrl), threadUrl.replace(BASE, ''));

    await alice.page.waitForTimeout(2500);
    const composer = alice.page.getByRole('textbox', { name: /Message/i }).first();
    record('the composer is enabled, so the thread can be sealed',
        await composer.count() > 0 && await composer.isEnabled(), (await body(alice.page)).slice(0, 80).replace(/\n/g, ' '));

    const FROM_DANA = 'Sealed hello from Dana ' + Date.now();
    await composer.click();
    await composer.fill(FROM_DANA);
    await alice.page.getByRole('button', { name: /^Send$/ }).first().click();
    record('Dana’s message appears in her own thread', await waitForText(alice.page, FROM_DANA), '');

    const stored = sql(`select body from messages where kind = 'text' order by created_at desc limit 1`);
    record('the server stores ciphertext, not the words',
        stored !== '' && !stored.includes('Sealed hello'), stored.slice(0, 48) + '…');

    await bob.page.goto(`${ BASE }/app/chats`, { waitUntil: 'networkidle' });
    await bob.page.waitForTimeout(2500);
    const bobThread = bob.page.locator('a[href^="/app/chats/"]').first();
    record('Mina sees the new conversation in her list', await bobThread.count() > 0, '');
    await bobThread.click();
    const bobOpened = await waitForTextReloading(bob.page, FROM_DANA);
    record('MINA CAN OPEN DANA’S SEALED MESSAGE', bobOpened,
        bobOpened ? '' : 'thread says: ' + (await body(bob.page)).slice(0, 160).replace(/\n/g, ' | '));

    const FROM_MINA = 'Sealed reply from Mina ' + Date.now();
    const bobComposer = bob.page.getByRole('textbox', { name: /Message/i }).first();
    await bobComposer.click();
    await bobComposer.fill(FROM_MINA);
    await bob.page.getByRole('button', { name: /^Send$/ }).first().click();
    record('Mina can send into the same epoch', await waitForText(bob.page, FROM_MINA), '');

    const danaRead = await waitForTextReloading(alice.page, FROM_MINA);
    record('DANA CAN OPEN MINA’S REPLY', danaRead,
        danaRead ? '' : 'thread says: ' + (await body(alice.page)).slice(-160).replace(/\n/g, ' | '));

    const epochs = sql('select count(*) from conversation_epochs');
    record('exactly one epoch was minted for the thread', epochs === '1', `${ epochs } epochs`);

    // ---------------------------------------------------------------- groups
    section('groups');
    await alice.page.goto(`${ BASE }/app/friends`, { waitUntil: 'networkidle' });
    await alice.page.waitForTimeout(2000);

    // Nothing about groups is on screen until the tab is chosen, and the tab's accessible name
    // carries a count once there are any - so match the start of it, not the whole string.
    const groupsTab = alice.page.locator('[role="tab"]').filter({ hasText: /^Groups/ }).first();
    record('Friends has a Groups tab', await groupsTab.count() > 0, '');
    await groupsTab.click();
    await alice.page.waitForTimeout(1500);

    const newGroup = alice.page.getByRole('button', { name: /^New group$/ }).first();
    record('a group can be started from the Groups tab', await newGroup.count() > 0, '');
    await newGroup.click();

    // The dialog's submit button reuses the trigger's copy, so everything below is scoped to the
    // dialog - a page-wide match would find the trigger again.
    const form = alice.page.locator('[role="dialog"][aria-label="Start a group"]');
    await form.waitFor({ state: 'visible', timeout: 15000 });
    record('the create-group form opens', await form.isVisible(), '');

    await form.locator('#group-name').click();
    await alice.page.keyboard.type(GROUP_NAME, { delay: 12 });
    await alice.page.waitForTimeout(600);
    await form.locator('form button[type="submit"]').first().click();
    await alice.page.waitForTimeout(4500);

    const slug = sql(`select slug from groups where name = '${ GROUP_NAME }'`);
    record('the group exists, its slug claimed by insert', slug !== '', slug);
    record('the slug hyphenates the name rather than stripping it', slug === 'tuesday-backgammon', slug);

    const ownerRows = sql(`select count(*) from group_members m join groups g on g.id = m.group_id
        where g.name = '${ GROUP_NAME }' and m.role = 'owner'`);
    record('exactly one owner, as the partial index demands', ownerRows === '1', `${ ownerRows }`);
    record('creating lands on the group page', alice.page.url().includes(`/app/groups/${ slug }`), alice.page.url().replace(BASE, ''));

    await alice.page.goto(`${ BASE }/app/groups/${ slug }`, { waitUntil: 'networkidle' });
    await alice.page.waitForTimeout(2500);
    record('the group page opens by slug', (await body(alice.page)).includes(GROUP_NAME), '');

    // ---------------------------------------------------------------- add a member
    const addFriend = alice.page.getByRole('button', { name: /^Add a friend$/ }).first();
    record('the owner is offered "Add a friend"', await addFriend.count() > 0, '');
    await addFriend.click();

    const picker = alice.page.locator('[role="dialog"][aria-label="Add a friend"]');
    await picker.waitFor({ state: 'visible', timeout: 15000 });
    const candidate = picker.locator('li button').filter({ hasText: BOB.name }).first();
    record('the picker offers Mina, who is now a friend', await candidate.count() > 0,
        (await picker.innerText()).replace(/\n+/g, ' | ').slice(0, 140));
    await candidate.click();
    await alice.page.waitForTimeout(3500);

    const members = sql(`select count(*) from group_members m join groups g on g.id = m.group_id
        where g.name = '${ GROUP_NAME }'`);
    record('the group now has two members', members === '2', `${ members }`);

    const seated = sql(`select count(*) from conversation_members cm
        join conversations c on c.id = cm.conversation_id
        join groups g on g.id = c.group_id where g.name = '${ GROUP_NAME }'`);
    record('membership moved in lockstep with the group conversation', seated === '2', `${ seated } seated`);

    // ---------------------------------------------------------------- the other side sees it
    await bob.page.goto(`${ BASE }/app/friends`, { waitUntil: 'networkidle' });
    await bob.page.waitForTimeout(2000);
    await bob.page.locator('[role="tab"]').filter({ hasText: /^Groups/ }).first().click();
    await bob.page.waitForTimeout(2000);
    record('Mina sees the group she was added to', (await body(bob.page)).includes(GROUP_NAME), '');

    await bob.page.goto(`${ BASE }/app/groups/${ slug }`, { waitUntil: 'networkidle' });
    await bob.page.waitForTimeout(2500);
    const groupChat = bob.page.getByRole('link', { name: /^Group chat$/ }).first();
    record('Mina can reach the group chat', await groupChat.count() > 0, '');
    await groupChat.click();
    await bob.page.waitForTimeout(4000);

    const lines = await body(bob.page);
    record('the group thread carries the system line for its creation',
        /started this group/i.test(lines), lines.replace(/\n+/g, ' | ').slice(-160));

    // ---------------------------------------------------------------- a sealed group message
    await alice.page.goto(`${ BASE }/app/groups/${ slug }`, { waitUntil: 'networkidle' });
    await alice.page.waitForTimeout(2000);
    await alice.page.getByRole('link', { name: /^Group chat$/ }).first().click();
    await alice.page.waitForTimeout(5000);

    const GROUP_MESSAGE = 'Sealed to the whole group ' + Date.now();
    const groupComposer = alice.page.getByRole('textbox', { name: /^Message$/ }).first();
    record('the group composer is available', await groupComposer.count() > 0 && await groupComposer.isEnabled(), '');
    await groupComposer.click();
    await groupComposer.fill(GROUP_MESSAGE);
    await alice.page.getByRole('button', { name: /^Send$/ }).first().click();
    record('Dana’s group message is in her thread', await waitForText(alice.page, GROUP_MESSAGE), '');

    const minaReadGroup = await waitForTextReloading(bob.page, GROUP_MESSAGE);
    record('MINA CAN OPEN THE SEALED GROUP MESSAGE', minaReadGroup,
        minaReadGroup ? '' : (await body(bob.page)).replace(/\n+/g, ' | ').slice(-160));

    // ---------------------------------------------------------------- leaving
    await bob.page.goto(`${ BASE }/app/groups/${ slug }`, { waitUntil: 'networkidle' });
    await bob.page.waitForTimeout(2500);
    const leave = bob.page.locator('#app-shell').getByRole('button', { name: /^Leave group$/ }).first();
    record('a member is offered "Leave group"', await leave.count() > 0, '');
    await leave.click();
    await bob.page.waitForTimeout(1500);
    const confirm = bob.page.locator('[role="dialog"]').getByRole('button', { name: /^Leave group$/ }).first();
    await confirm.click();
    await bob.page.waitForTimeout(4000);

    const after = sql(`select count(*) from group_members m join groups g on g.id = m.group_id
        where g.name = '${ GROUP_NAME }'`);
    record('leaving takes the seat back', after === '1', `${ after } members left`);

    const stillSeated = sql(`select count(*) from conversation_members cm
        join conversations c on c.id = cm.conversation_id
        join groups g on g.id = c.group_id where g.name = '${ GROUP_NAME }'`);
    record('and takes the conversation seat with it', stillSeated === '1', `${ stillSeated } seated`);

    await alice.page.reload({ waitUntil: 'networkidle' });
    await alice.page.waitForTimeout(5000);
    record('the thread says she left, rather than saying nothing',
        /left/i.test(await body(alice.page)), (await body(alice.page)).replace(/\n+/g, ' | ').slice(-140));

    // ---------------------------------------------------------------- console
    section('the console, across both browsers');
    record('Dana’s browser logged no errors', alice.errors.length === 0, alice.errors.slice(0, 4).join(' ; '));
    record('Mina’s browser logged no errors', bob.errors.length === 0, bob.errors.slice(0, 4).join(' ; '));

    await browser.close();

}
catch (error)
{
    record('the pass ran to the end', false, String(error?.message ?? error).slice(0, 200));
    await browser.close().catch(() => {});
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${ results.length - failed.length }/${ results.length } checks passed`);
if (failed.length)
{
    console.log('\nFAILURES');
    for (const f of failed)
    {
        console.log(`  [${ f.section }] ${ f.name }${ f.detail ? ': ' + f.detail : '' }`);
    }
    process.exitCode = 1;
}
