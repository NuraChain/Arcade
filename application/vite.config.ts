import { azeroth } from '@azerothjs/compiler';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';

// The framework is consumed from the LOCAL monorepo through `file:` specs, which npm installs
// as junctions. Everything unusual in this config exists to make that safe - see each note.
const AZEROTH_MONOREPO = 'C:/Users/IntelligentQuantum/Documents/Projects/AzerothJS';

export default defineConfig({
    plugins: [azeroth(), tailwindcss()],

    resolve:
    {
        // THE failure this prevents is silent. Every compiled .azeroth module imports
        // `azerothjs/internal`, whose signal graph, owner stack and scheduler are module-level
        // singletons; two copies in one bundle means two independent reactive graphs, so
        // effects never fire and onCleanup never runs - and nothing throws. dedupe pins one.
        //
        // `preserveSymlinks` must stay at its default false: collapsing the junction to its
        // realpath is exactly what makes one copy possible.
        dedupe: ['azerothjs', '@azerothjs/schema']
    },

    optimizeDeps:
    {
        // Vite does not pre-bundle a dependency whose realpath lies outside the project, so
        // these would be excluded anyway. Stating it keeps the behaviour from depending on
        // that detail, and means a framework edit is visible without clearing node_modules/.vite.
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
        fs:
        {
            // The junctions resolve to a realpath OUTSIDE this project and outside its
            // workspace root - AzerothJS is a sibling of Nura, not an ancestor - so without
            // this the dev server answers 403 for every framework module.
            allow: ['..', AZEROTH_MONOREPO]
        }
    },

    test:
    {
        environment: 'happy-dom'
    }
});
