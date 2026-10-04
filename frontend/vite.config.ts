import { azeroth } from '@azerothjs/compiler';
import tailwindcss from '@tailwindcss/vite';
import { existsSync } from 'node:fs';
import { isAbsolute, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv, type Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

process.env.VITE_USER_NODE_ENV ??= '';

const REQUIRED_ENV = [
    'VITE_NURA_CHAIN_ID',
    'VITE_NURA_CHAIN_NAME',
    'VITE_NURA_CURRENCY_NAME',
    'VITE_NURA_CURRENCY_SYMBOL',
    'VITE_NURA_RPC_URL',
    'VITE_NURA_EXPLORER_URL',
    'VITE_NURA_SITE',
    'VITE_PUBLIC_ORIGIN'
];

const requireEnv = (mode: string) =>
{
    const root = fileURLToPath(new URL('..', import.meta.url));

    if (!existsSync(new URL('../.env', import.meta.url)))
    {
        throw new Error('There is no .env at the repository root. Copy .env.example to .env and fill it in.');
    }

    const env = loadEnv(mode, root, 'VITE_');
    const absent = REQUIRED_ENV.filter((name) => env[name] === undefined);

    if (absent.length > 0)
    {
        throw new Error(`The root .env does not set ${ absent.join(', ') }. Every variable in .env.example has to be written in .env.`);
    }
};

const shareOrigin = (): Plugin =>
{
    let origin = '';

    return {
        name: 'nura-share-origin',
        configResolved: (config) =>
        {
            origin = String(config.env.VITE_PUBLIC_ORIGIN ?? '').replace(/\/+$/, '');
        },
        transformIndexHtml: (html) =>
            origin === '' ? html : html.replaceAll('content="/share.jpg"', `content="${ origin }/share.jpg"`)
    };
};

const chunkModules = (): Plugin =>
{
    let root = '';

    return {
        name: 'nura-chunk-modules',
        apply: 'build',
        configResolved: (config) =>
        {
            root = config.root;
        },
        generateBundle(_options, bundle)
        {
            const chunks = Object.fromEntries(Object.values(bundle)
                .filter((output) => output.type === 'chunk')
                .map((chunk) => [chunk.fileName, Object.entries(chunk.modules)
                    .filter(([, module]) => module.renderedLength > 0)
                    .map(([id]) => id.replace(/\?.*$/, ''))
                    .map((id) => isAbsolute(id) ? relative(root, id).replaceAll('\\', '/') : id)]));

            this.emitFile({ type: 'asset', fileName: '.vite/chunks.json', source: JSON.stringify(chunks) });
        }
    };
};

export default defineConfig(({ isSsrBuild, mode }) =>
{
    requireEnv(mode);

    return {
        plugins: [azeroth(), tailwindcss(), shareOrigin(), ...(isSsrBuild === true ? [] : [chunkModules()])],

        cacheDir: '../node_modules/.vite',

        envDir: '..',

        resolve:
        {
            // THE failure this prevents is silent. Every compiled .azeroth module imports
            // `azerothjs/internal`, whose signal graph, owner stack and scheduler are module-level
            // singletons; two copies in one bundle means two independent reactive graphs, so
            // effects never fire and onCleanup never runs - and nothing throws. dedupe pins one.
            //
            // It survives the framework moving from a `file:` junction to a registry pin: npm already
            // installs one hoisted copy, and this is what keeps that true if a second ever appears.
            dedupe: ['azerothjs', '@azerothjs/schema']
        },

        optimizeDeps:
        {
            // This used to restate what vite did anyway, because a junction's realpath lay outside
            // the project and was never pre-bundled. From the registry it is inside `node_modules` like
            // anything else, so the exclusion is now a DECISION: the runtime's module-level signal
            // graph is exactly what `dedupe` above exists to keep single, and a pre-bundle is another
            // copy of a module for the two to disagree about.
            exclude: ['azerothjs', '@azerothjs/kit', '@azerothjs/devtools']
        },

        // The SSR bundle (src/entry.server.ts) inlines its dependencies so dist-server is ONE
        // self-contained file the prerenderer can run with no client node_modules.
        ssr:
        {
            noExternal: true
        },

        build:
        {
            // Rolldown warns at 500 kB of MINIFIED source, and one chunk here is deliberately past it:
            // `world-*` is three.js, a dynamic import inside `mount`, so it is not in the landing page's
            // initial set and does not block first paint - which is precisely what the warning's own
            // advice ("use dynamic import to code-split") asks for. It is measuring raw bytes and cannot
            // tell a lazy chunk from an eager one.
            //
            // `tools/budgets.mjs` is the real gate and measures what a visitor pays: gzip, per chunk,
            // with the landing page's initial set resolved from the prerendered HTML. It FAILS the
            // build rather than warning - three.js has to be lazy, and every board renderer has to sit
            // in a lazy chunk of its own under a 16 KB gzip ceiling.
            //
            // So this raises the generic warning above the one chunk that is meant to be large, rather
            // than switching it off: a SECOND library of that size appearing still says so, and
            // a warning nobody can act on is one that hides the ones they can.
            chunkSizeWarningLimit: 1500,

            outDir: '../.dist-frontend',
            emptyOutDir: true,

            assetsInlineLimit: (file: string) => file.endsWith('.cues') ? false : undefined,

            rolldownOptions: isSsrBuild === true ? {} : {
                output: {
                    codeSplitting: {
                        groups: [{ name: 'boot', tags: ['$initial'] }]
                    }
                }
            }
        },

        server:
        {
            // Declared rather than inherited: 3100 keeps this app clear of Explorer (3001) and its
            // api (3000) when both dev servers are up. Vite still steps on if the port is taken.
            port: 3100,
            host: '127.0.0.1',
            cors: false,

            // In dev the two halves are two processes, so the api has to be reachable on this
            // origin or every cookie would be cross-site. In production one server answers both
            // and these paths are mounted directly, which is why they are listed rather than
            // proxied by prefix guesswork. `ws: true` is what carries the realtime upgrade.
            proxy:
            {
                '/api': { target: 'http://127.0.0.1:3200', changeOrigin: false },
                '/ws': { target: 'ws://127.0.0.1:3200', ws: true },
                '/_image': { target: 'http://127.0.0.1:3200', changeOrigin: false },
                '/avatars': { target: 'http://127.0.0.1:3200', changeOrigin: false }
            },
            fs:
            {
                // `node_modules` is hoisted to the workspace ROOT, which is the parent of this
                // package - so without this the dev server answers 403 for every hoisted dependency.
                // It used to also name an absolute path to a sibling checkout, which is what a
                // `file:` junction's realpath needed and what made this config machine-specific.
                allow: ['..']
            }
        },

        test:
        {
            environment: 'happy-dom',

            // No unit test may reach the network. src/api.ts fetches the route manifest at module
            // load, so importing any store from a spec would otherwise open a real socket to a port
            // nothing is listening on - and bury a genuine failure in connection noise.
            setupFiles: ['./tests/setup.ts']
        }
    };
});
