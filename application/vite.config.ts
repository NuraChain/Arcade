import { azeroth } from '@azerothjs/compiler';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    plugins: [azeroth(), tailwindcss()],

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

    server:
    {
        // Declared rather than inherited: 3100 keeps this app clear of Explorer (3001) and its
        // api (3000) when both dev servers are up. Vite still steps on if the port is taken.
        port: 3100,

        // In dev the two halves are two processes, so the api has to be reachable on this
        // origin or every cookie would be cross-site. In production one server answers both
        // and these paths are mounted directly, which is why they are listed rather than
        // proxied by prefix guesswork. `ws: true` is what carries the realtime upgrade.
        proxy:
        {
            '/api': { target: 'http://localhost:3200', changeOrigin: false },
            '/ws': { target: 'ws://localhost:3200', ws: true },
            '/_image': { target: 'http://localhost:3200', changeOrigin: false }
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
});
