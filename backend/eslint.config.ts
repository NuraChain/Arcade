import tseslint from 'typescript-eslint';
import { defineConfig, globalIgnores } from 'eslint/config';

import { nura } from '../tools/eslint/return-types.ts';

const config: ReturnType<typeof defineConfig> = defineConfig([
    globalIgnores(['**/node_modules/**']),
    {
        files: ['**/*.ts'],
        languageOptions: { parser: tseslint.parser },
        plugins: { '@typescript-eslint': tseslint.plugin, nura },
        rules:
        {
            '@typescript-eslint/no-inferrable-types': 'error',
            'nura/prefer-inferred-return-type': 'error'
        }
    },
    {
        files: ['src/**/*.ts', 'tests/**/*.ts'],
        languageOptions:
        {
            parserOptions: { project: './tsconfig.test.json', tsconfigRootDir: import.meta.dirname }
        }
    }
]);

export default config;
