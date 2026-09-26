import { defineConfig } from 'vitest/config';

// THE FILENAME IS LOAD-BEARING. `vite.config.ts` here would make the CLI's detect.ts see a vite
// config in a directory that declares neither vite nor a frontend package, which drops the
// workspace to kind:'none', collapses fullstack detection, and makes every `azeroth` command
// exit 2. `vitest.config.ts` is not in its VITE_CONFIGS list.
//
// Vite 8 transforms with oxc, NOT esbuild - an `esbuild` block here is silently ignored with a
// warning. oxc does not pick up ./tsconfig.json for files under tests/ (that tsconfig includes
// only src/), so the decorator transform is stated explicitly below. Without it a spec that
// imports an entity dies with a bare "SyntaxError: Invalid or unexpected token", which names
// neither decorators nor the config that would fix them.
//
// `emitDecoratorMetadata` is what makes `design:type` exist, and TypeORM reads it to infer a
// column type. tests/decorator-metadata.spec.ts pins all of this so it cannot regress quietly.
export default defineConfig({
    oxc:
    {
        decorator:
        {
            legacy: true,
            emitDecoratorMetadata: true
        },
        typescript:
        {
            // oxc's spelling of tsconfig's `useDefineForClassFields: false`. An entity declares
            // `id!: string` with no initializer; under [[Define]] semantics that installs an own
            // property holding `undefined` over the prototype accessor TypeORM attaches for a
            // relation. The symptom is "my relation is always undefined" and "the entity saved
            // nulls" - silent corruption, never a crash.
            removeClassFieldsWithoutInitializer: true
        }
    },

    test:
    {
        environment: 'node',
        setupFiles: ['reflect-metadata'],
        typecheck:
        {
            tsconfig: './tsconfig.test.json'
        }
    }
});
