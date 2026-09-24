import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { BASE, guestSeat, launch, seat } from './seats.mjs';

const OUT = 'tools/qa/out/parity';

const PROPS = [
    'display', 'position', 'top', 'right', 'bottom', 'left', 'z-index', 'float', 'box-sizing',
    'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
    'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
    'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    'flex-direction', 'flex-wrap', 'flex-grow', 'flex-shrink', 'flex-basis', 'order', 'align-items', 'align-self', 'justify-content', 'justify-items', 'place-self',
    'grid-template-columns', 'grid-template-rows', 'grid-template-areas', 'grid-area', 'row-gap', 'column-gap',
    'font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing', 'text-align', 'text-transform', 'text-decoration-line', 'white-space', 'text-overflow', 'overflow-wrap', 'direction',
    'color', 'background-color', 'background-image', 'background-size', 'background-position', 'background-repeat',
    'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
    'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style',
    'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
    'border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius',
    'outline-style', 'outline-width', 'outline-color', 'outline-offset',
    'box-shadow', 'opacity', 'visibility', 'transform', 'translate', 'rotate', 'scale', 'filter', 'backdrop-filter', 'mix-blend-mode',
    'overflow-x', 'overflow-y', 'overscroll-behavior-y', 'scroll-snap-type', 'scroll-snap-align',
    'cursor', 'pointer-events', 'user-select', 'touch-action',
    'aspect-ratio', 'object-fit', 'container-type', 'container-name', 'mask-image', 'clip-path', 'inset-inline-start', 'fill', 'stroke'
];

const PSEUDO = ['content', 'display', 'position', 'top', 'right', 'bottom', 'left', 'width', 'height', 'background-color', 'background-image', 'border-top-width', 'border-top-color', 'border-top-left-radius', 'box-shadow', 'opacity', 'transform', 'rotate'];

const QUIET = '*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }';

const snapshot = ({ props, pseudo }) =>
{
    const out = {};

    const keyOf = (element) =>
    {
        const parts = [];
        let node = element;

        while (node !== null && node !== document.body)
        {
            const parent = node.parentElement;
            const index = parent === null ? 0 : [...parent.children].indexOf(node);
            parts.unshift(`${ node.tagName.toLowerCase() }${ index }`);
            node = parent;
        }

        return parts.join('>');
    };

    for (const element of document.body.querySelectorAll('*'))
    {
        if (element.closest('svg') !== null && element.tagName.toLowerCase() !== 'svg')
        {
            continue;
        }

        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        const entry = { r: [rect.x, rect.y, rect.width, rect.height].map((value) => Math.round(value)), s: props.map((prop) => style.getPropertyValue(prop)) };

        for (const which of ['::before', '::after'])
        {
            const extra = getComputedStyle(element, which);

            if (extra.content !== 'none' && extra.content !== 'normal')
            {
                entry[which] = pseudo.map((prop) => extra.getPropertyValue(prop));
            }
        }

        out[keyOf(element)] = entry;
    }

    return out;
};

const settle = async (page) =>
{
    await page.waitForLoadState('networkidle').catch(() => undefined);
    await page.addStyleTag({ content: QUIET });
    await page.waitForTimeout(1200);
};

const tablesFile = join(OUT, 'tables.json');

const nowFile = join(OUT, 'now.json');

const frozen = () =>
{
    if (!existsSync(nowFile))
    {
        writeFileSync(nowFile, JSON.stringify(Date.now()));
    }
    return JSON.parse(readFileSync(nowFile, 'utf8'));
};

const freeze = async (context, locale, at) =>
{
    await context.addInitScript(({ locale: chosen, at: moment }) =>
    {
        localStorage.setItem('nura-games.locale', chosen);
        Date.now = () => moment;
    }, { locale, at });
};

const tablesFor = async (browser, dana) =>
{
    if (existsSync(tablesFile))
    {
        return JSON.parse(readFileSync(tablesFile, 'utf8'));
    }

    const tables = {};

    for (const [game, seats, target] of [['ludo', 2, 0], ['backgammon', 2, 1], ['hokm', 2, 7]])
    {
        const guest = await guestSeat(browser, `Parity ${ game }`);
        const made = await dana.api('POST', '/tables/', { game, seats, mode: 'turns', privacy: 'public', target, cube: game === 'backgammon', blinds: 'low', chat: true, voice: false, invitees: [] });
        await guest.api('POST', `/tables/${ made.body.id }/seat`);
        await dana.api('POST', `/tables/${ made.body.id }/ready`, { ready: true });
        await guest.api('POST', `/tables/${ made.body.id }/ready`, { ready: true });
        await dana.api('POST', `/tables/${ made.body.id }/start`);
        await guest.context.close();
        tables[game] = made.body.id;
    }

    writeFileSync(tablesFile, JSON.stringify(tables));
    return tables;
};

const record = async (name) =>
{
    mkdirSync(join(OUT, name), { recursive: true });

    const browser = await launch();
    const dana = await seat(browser, 'dana.w');
    const tables = await tablesFor(browser, dana);
    const at = frozen();
    const conversation = ((await dana.api('GET', '/chat/')).body?.conversations ?? []).find((one) => one.kind === 'direct')?.id ?? '';

    const signedIn = [
        '/app', '/app/games', '/app/watch', '/app/games/backgammon', '/app/games/hokm/create', '/app/friends', '/app/people/sara.k',
        '/app/chats', `/app/chats/${ conversation }`, '/app/groups/balcony-backgammon', '/app/leaderboard', '/app/discover',
        '/app/search', '/app/notifications', '/app/me', '/app/me/settings', '/app/me/devices',
        ...Object.values(tables).map((id) => `/app/play/${ id }`)
    ];

    const configs = [
        { id: 'en-390', viewport: { width: 390, height: 844 }, locale: 'en' },
        { id: 'en-1440', viewport: { width: 1440, height: 900 }, locale: 'en' },
        { id: 'fa-390', viewport: { width: 390, height: 844 }, locale: 'fa' }
    ];

    for (const config of configs)
    {
        const context = await browser.newContext({ viewport: config.viewport, locale: 'en-US', storageState: await dana.context.storageState() });
        await freeze(context, config.locale, at);
        const page = await context.newPage();

        for (const path of signedIn)
        {
            await page.goto(`${ BASE }${ path }`);
            await settle(page);
            const file = join(OUT, name, `${ config.id }${ path.replaceAll('/', '_') }.json`);
            writeFileSync(file, JSON.stringify(await page.evaluate(snapshot, { props: PROPS, pseudo: PSEUDO })));
        }

        await context.close();

        const anonymous = await browser.newContext({ viewport: config.viewport, locale: 'en-US' });
        await freeze(anonymous, config.locale, at);
        const open = await anonymous.newPage();

        for (const path of ['/', '/sign-in'])
        {
            await open.goto(`${ BASE }${ path }`);
            await settle(open);
            writeFileSync(join(OUT, name, `${ config.id }_anon${ path.replaceAll('/', '_') }.json`), JSON.stringify(await open.evaluate(snapshot, { props: PROPS, pseudo: PSEUDO })));
        }

        await anonymous.close();
        console.log(`recorded ${ config.id }`);
    }

    await browser.close();
};

const diff = (before, after) =>
{
    const files = readdirSync(join(OUT, before)).filter((file) => file.endsWith('.json'));
    let total = 0;

    for (const file of files)
    {
        const a = JSON.parse(readFileSync(join(OUT, before, file), 'utf8'));
        const bPath = join(OUT, after, file);

        if (!existsSync(bPath))
        {
            console.log(`${ file }: missing in ${ after }`);
            continue;
        }

        const b = JSON.parse(readFileSync(bPath, 'utf8'));
        const findings = [];
        const onlyA = Object.keys(a).filter((key) => !(key in b)).length;
        const onlyB = Object.keys(b).filter((key) => !(key in a)).length;

        for (const [key, one] of Object.entries(a))
        {
            const two = b[key];

            if (two === undefined)
            {
                continue;
            }

            one.s.forEach((value, index) =>
            {
                if (value !== two.s[index])
                {
                    findings.push(`${ key } ${ PROPS[index] }: ${ value } -> ${ two.s[index] }`);
                }
            });

            if (one.r.some((value, index) => Math.abs(value - two.r[index]) > 1))
            {
                findings.push(`${ key } box: ${ one.r.join(',') } -> ${ two.r.join(',') }`);
            }

            for (const which of ['::before', '::after'])
            {
                if (JSON.stringify(one[which] ?? null) !== JSON.stringify(two[which] ?? null))
                {
                    findings.push(`${ key }${ which }: ${ JSON.stringify(one[which] ?? null) } -> ${ JSON.stringify(two[which] ?? null) }`);
                }
            }
        }

        total += findings.length + onlyA + onlyB;

        if (findings.length > 0 || onlyA > 0 || onlyB > 0)
        {
            console.log(`\n${ file }: ${ findings.length } differences, ${ onlyA } elements gone, ${ onlyB } new`);
            for (const line of findings.slice(0, Number(process.env.PARITY_SHOW ?? 12)))
            {
                console.log(`  ${ line }`);
            }
        }
    }

    console.log(`\nstyle-parity: ${ total === 0 ? 'identical' : `${ total } differences` } across ${ files.length } pages`);
    process.exitCode = total === 0 ? 0 : 1;
};

const [mode, first, second] = process.argv.slice(2);

if (mode === 'record')
{
    await record(first);
}
else if (mode === 'compare')
{
    diff(first, second);
}
else
{
    console.log('usage: node tools/qa/style-parity.mjs record <name> | compare <before> <after>');
}
