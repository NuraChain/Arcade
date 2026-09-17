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
 */
import { readFileSync, readdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'application', 'dist');
const ASSETS = join(DIST, 'assets');

const KB = 1024;

/** The landing page's whole JavaScript payload: the entry plus everything it preloads. */
const INITIAL_BUDGET = 60 * KB;

/** The `/app` layout chunk, which every signed-in route waits on. */
const SHELL_BUDGET = 12 * KB;

/** Any one route's own chunk. */
const ROUTE_BUDGET = 15 * KB;

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
    { match: /^connect-dialog\.component-/, why: 'public-shell imports connect-dialog dynamically' }
];

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

// ---------------------------------------------------------------- say what was measured, always
const shell = all.find((name) => /^app-shell\.component-/.test(name));
const pages = all.filter((name) => /\.page-/.test(name)).map((name) => gzip(name));

console.log(`  initial JS   ${ size(initialBytes) } / ${ size(INITIAL_BUDGET) }  (${ initial.length } chunks)`);
console.log(`  app shell    ${ shell === undefined ? 'absent' : size(gzip(shell)) } / ${ size(SHELL_BUDGET) }`);
console.log(`  routes       ${ pages.length } chunks, largest ${ size(Math.max(0, ...pages)) } / ${ size(ROUTE_BUDGET) }`);

if (problems.length > 0)
{
    console.error('\n  JS budget exceeded:\n');
    for (const problem of problems)
    {
        console.error(`    - ${ problem }`);
    }
    console.error('');
    process.exit(1);
}

console.log('  ✓ within budget');
