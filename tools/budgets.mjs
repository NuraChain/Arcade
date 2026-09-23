/**
 * The JavaScript budgets, as a build failure rather than a paragraph.
 *
 * CLAUDE.md has stated these numbers for a long time and nothing checked any of them, while
 * `tools/blender/build.mjs` really does fail on `ATLAS_BUDGET_BYTES` - so the 3D assets had a gate
 * and the JavaScript did not. That file also records the case only a person caught: a static import
 * of `attestation.ts` "pushed that chunk from 5.7 KB to 19.8 KB, past its budget". This is what
 * would have said so.
 *
 * The four DYNAMIC-import rules are the valuable half. Each one exists for a reason written down
 * beside it, each is one keystroke from being undone, and each failure is silent: the page still
 * works, it just pays for the whole typed api client - and its top-level await on the route
 * manifest - on a route whose entire promise is that it paints with no JavaScript and no server.
 *
 * The last check is a different kind of silence. `class={ [ ..., signal() ? 'a' : 'b' ].join(' ') }`
 * compiles to a bare `setProp`, not a `createEffect`, so the class is written once and never again:
 * correct on first render and stale forever after. Both segmented controls shipped that way - the
 * selected pill stayed on whichever option was chosen when the control mounted, while `aria-pressed`
 * moved correctly, so the markup was right and only the paint was wrong. Nothing could see it:
 * `npm run qa` reads overflow, hit targets, a landmark and the console, and an accessibility check
 * reads the aria. This reads the emitted bundle, which is the only place the difference exists.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'application', 'dist');
const ASSETS = join(DIST, 'assets');
const SSR_ASSETS = join(ROOT, 'application', 'dist-server', 'assets');

const KB = 1024;

/** The landing page's whole JavaScript payload: the entry plus everything it preloads. */
const INITIAL_BUDGET = 60 * KB;

/** The `/app` layout chunk, which every signed-in route waits on. */
const SHELL_BUDGET = 12 * KB;

/** Any one route's own chunk. */
const ROUTE_BUDGET = 15 * KB;

const SOUND_BUDGET = 160 * KB;

/**
 * Chunks that must NOT be in the landing page's initial set, and why.
 *
 * `world` is three.js and is a dynamic import inside `mount`, so it never reaches the prerenderer
 * and never blocks first paint. The other three are the imports CLAUDE.md names as load-bearing:
 * the app message catalogue, the typed api client behind `lib/guards.ts`, and the wallet chooser
 * behind `public-shell`. A static import of any of them puts `api.ts` - and its TOP-LEVEL await on
 * `/api/_manifest` - into a page that is prerendered to a file and is supposed to need no server.
 */
const MUST_BE_LAZY = [
    { match: /^world-/, why: 'three.js — dynamic import inside mount, after first paint' },
    { match: /^app-catalogue-/, why: 'the app message catalogue — only the shell and sign-in import it' },
    { match: /^session\.store-/, why: 'lib/guards.ts imports session.store.ts dynamically' },
    { match: /^connect-dialog\.component-/, why: 'public-shell imports connect-dialog dynamically' },
    { match: /-board-/, why: 'a board renderer — dynamic import inside mount, only once a match is running' }
];

const BOARD_BUDGET = 16 * KB;

const gzip = (name) => gzipSync(readFileSync(join(ASSETS, name))).length;

const size = (bytes) => `${ (bytes / KB).toFixed(1) } KB`;

function initialChunks()
{
    const html = readFileSync(join(DIST, 'index.html'), 'utf8');
    const names = new Set();

    for (const [, href] of html.matchAll(/(?:src|href)="\/assets\/([A-Za-z0-9._-]+\.js)"/g))
    {
        names.add(href);
    }

    return [...names];
}

const problems = [];

// ---------------------------------------------------------------- the landing page's payload
const initial = initialChunks();

if (initial.length === 0)
{
    problems.push('no module scripts found in dist/index.html — has the client been built?');
}

const initialBytes = initial.reduce((total, name) => total + gzip(name), 0);

if (initialBytes > INITIAL_BUDGET)
{
    const worst = initial
        .map((name) => ({ name, bytes: gzip(name) }))
        .sort((a, b) => b.bytes - a.bytes)
        .slice(0, 5)
        .map((entry) => `${ entry.name } ${ size(entry.bytes) }`)
        .join(', ');

    problems.push(`initial JS is ${ size(initialBytes) }, over the ${ size(INITIAL_BUDGET) } budget — largest: ${ worst }`);
}

// ---------------------------------------------------------------- what must not be in it
for (const rule of MUST_BE_LAZY)
{
    const found = initial.find((name) => rule.match.test(name));
    if (found !== undefined)
    {
        problems.push(`${ found } is in the landing page's initial set and must be lazy — ${ rule.why }`);
    }
}

// ---------------------------------------------------------------- per-chunk ceilings
const all = readdirSync(ASSETS).filter((name) => name.endsWith('.js'));

for (const name of all)
{
    const bytes = gzip(name);

    if (/^app-shell\.component-/.test(name) && bytes > SHELL_BUDGET)
    {
        problems.push(`${ name } is ${ size(bytes) }, over the ${ size(SHELL_BUDGET) } shell budget`);
    }

    if (/\.page-/.test(name) && bytes > ROUTE_BUDGET)
    {
        problems.push(`${ name } is ${ size(bytes) }, over the ${ size(ROUTE_BUDGET) } route budget`);
    }
}

// ---------------------------------------------------------------- the board renderers
//
// The scenes come from the registry rather than from a filename, so a second game's renderer is
// measured by the same rule. Each one is a dynamic import inside `mount`: it has to land in a chunk of
// its own, never in the landing page's initial set and never folded into a route or a component.
const SCENES = join(ROOT, 'application', 'src', 'game', 'scenes.ts');

let boardChunk = null;

if (existsSync(SCENES))
{
    const registry = readFileSync(SCENES, 'utf8');
    const games = [...registry.matchAll(/^\s{4}(\w[\w-]*):\s*async/gm)].map((one) => one[1]);
    const modules = [...registry.matchAll(/await import\('([^']+)'\)/g)].map((one) => one[1]);

    if (games.length === 0)
    {
        problems.push('game/scenes.ts registers no scene, so the board checks measured nothing');
    }

    if (modules.length !== games.length)
    {
        problems.push(`game/scenes.ts registers ${ games.length } scenes but ${ modules.length } dynamic imports — every scene must load its own`);
    }

    for (const specifier of modules)
    {
        const file = join(ROOT, 'application', 'src', 'game', specifier.replace(/^\.\//, ''));

        if (!existsSync(file))
        {
            problems.push(`game/scenes.ts imports ${ specifier }, which is not on disk`);
            continue;
        }

        const stem = specifier.split('/').pop().replace(/\.ts$/, '');
        const chunk = all.find((name) => name.startsWith(`${ stem }-`));

        if (chunk === undefined)
        {
            problems.push(`${ specifier } has no chunk of its own — it must stay behind the dynamic import in mount`);
            continue;
        }

        boardChunk = chunk;

        if (initial.includes(chunk))
        {
            problems.push(`${ chunk } is in the landing page's initial set`);
        }

        if (gzip(chunk) > BOARD_BUDGET)
        {
            problems.push(`${ chunk } is ${ size(gzip(chunk)) }, over the ${ size(BOARD_BUDGET) } board budget`);
        }
    }
}

// ---------------------------------------------------------------- class bindings that never update
let classBindsRead = 0;

if (!existsSync(SSR_ASSETS))
{
    problems.push(`${ SSR_ASSETS } is missing, so no class binding was read - this check cannot pass by finding nothing`);
}
else
{
    for (const name of readdirSync(SSR_ASSETS).filter((file) => file.endsWith('.js')))
    {
        let region = name;

        for (const line of readFileSync(join(SSR_ASSETS, name), 'utf8').split('\n'))
        {
            const marked = /^\/\/#region (.+)$/.exec(line);

            if (marked !== null)
            {
                region = marked[1];
            }

            if (!line.includes('setProp(') || !line.includes('"class"'))
            {
                continue;
            }

            classBindsRead += 1;

            if (line.includes('createEffect'))
            {
                continue;
            }

            const reads = [...line.slice(line.indexOf('"class",') + 8).matchAll(/(\w+(?:\.\w+)*)\(\)/g)]
                .map((match) => match[1])
                .filter((read) => !/(join|filter|trim)$/.test(read));

            if (reads.length > 0)
            {
                problems.push(`${ region } binds class once from ${ reads.join(', ') } - write it as class={ () => [ ... ] }`);
            }
        }
    }

    if (classBindsRead === 0)
    {
        problems.push('no class binding was found in the SSR bundle, so this check measured nothing');
    }
}

const sounds = readdirSync(ASSETS).filter((name) => /^table-.*.cues$/.test(name));
const soundTotal = sounds.reduce((sum, name) => sum + statSync(join(ASSETS, name)).size, 0);

if (sounds.length !== 1)
{
    problems.push(`${ sounds.length } table sound packs reached dist/assets, expected exactly one`);
}

if (readdirSync(ASSETS).some((name) => /.(mp3|ogg|wav|m4a)$/.test(name)))
{
    problems.push('an audio file with a media extension reached dist/assets - a download manager grabs those and hands the page an empty 204');
}

if (soundTotal > SOUND_BUDGET)
{
    problems.push(`the table sounds are ${ size(soundTotal) }, over ${ size(SOUND_BUDGET) }`);
}

// ---------------------------------------------------------------- say what was measured, always
const shell = all.find((name) => /^app-shell\.component-/.test(name));
const pages = all.filter((name) => /\.page-/.test(name)).map((name) => gzip(name));

console.log(`  initial JS   ${ size(initialBytes) } / ${ size(INITIAL_BUDGET) }  (${ initial.length } chunks)`);
console.log(`  app shell    ${ shell === undefined ? 'absent' : size(gzip(shell)) } / ${ size(SHELL_BUDGET) }`);
console.log(`  routes       ${ pages.length } chunks, largest ${ size(Math.max(0, ...pages)) } / ${ size(ROUTE_BUDGET) }`);
console.log(`  board        ${ boardChunk === null ? 'absent' : size(gzip(boardChunk)) } / ${ size(BOARD_BUDGET) }`);
console.log(`  sounds       ${ sounds.length } pack, ${ size(soundTotal) } / ${ size(SOUND_BUDGET) }`);
console.log(`  class binds  ${ classBindsRead } read, ${ problems.length === 0 ? 'every one that reads a signal effect-wrapped' : 'see below' }`);

if (problems.length > 0)
{
    console.error('\n  build refused:\n');
    for (const problem of problems)
    {
        console.error(`    - ${ problem }`);
    }
    console.error('');
    process.exit(1);
}

console.log('  ✓ within budget');
