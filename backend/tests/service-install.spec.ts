import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const installer = readFileSync(fileURLToPath(new URL('../../scripts/service-install.sh', import.meta.url)), 'utf8');
const unit = installer.slice(installer.indexOf('[Service]'), installer.indexOf('[Install]'));
const source = fileURLToPath(new URL('../src', import.meta.url));

const FS_NAMED = /import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*'(?:node:)?fs(?:\/promises)?'/g;

const FS_WHOLE = /import\s+(?:\*\s+as\s+)?\w+\s+from\s*'(?:node:)?fs(?:\/promises)?'/;

const READS = new Set(['access', 'constants', 'createReadStream', 'existsSync', 'lstat', 'readdir', 'readdirSync', 'readFile', 'readFileSync', 'realpath', 'stat', 'statSync']);

const writesOf = (text: string) => [...text.matchAll(FS_NAMED)]
    .flatMap((found) => found[1].split(',').map((name) => name.trim().split(/\s+as\s+/)[0]))
    .filter((name) => name !== '' && !READS.has(name))
    .concat(FS_WHOLE.test(text) ? ['the whole of fs'] : [])
    .concat(text.includes('FilePageCache') ? ['FilePageCache'] : []);

describe('the service the installer writes', () =>
{
    it('runs as whoever owns the clone, and refuses a clone root owns', () =>
    {
        expect(installer).toContain('SERVICE_USER="$(stat -c \'%U\' "$ROOT")"');
        expect(unit).toContain('User=$SERVICE_USER');
        expect(unit).toContain('Group=$SERVICE_GROUP');
        expect(installer).toMatch(/\[ "\$SERVICE_USER" != "root" \] \|\| refuse /);
    });

    it('can gain no privileges and write nothing but its own /tmp', () =>
    {
        expect(unit).toContain('NoNewPrivileges=true');
        expect(unit).toContain('PrivateTmp=true');
        expect(unit).toContain('ProtectSystem=strict');
        expect(unit).not.toContain('ReadWritePaths');
    });

    it('hands the log directory to the same account', () =>
    {
        expect(installer).toContain('chown "$SERVICE_USER:$SERVICE_GROUP" "$ROOT/.logs"');
    });

    it('is read-only because the server writes nothing to disk', () =>
    {
        const writers = readdirSync(source, { recursive: true, encoding: 'utf8' })
            .filter((file) => file.endsWith('.ts'))
            .map((file) => ({ file, writes: writesOf(readFileSync(join(source, file), 'utf8')) }))
            .filter((found) => found.writes.length > 0);

        expect(writers, 'a server file can write to disk: give the unit a ReadWritePaths= for where it writes').toEqual([]);
    });

    it('knows a write when it sees one', () =>
    {
        expect(writesOf(`import { createReadStream } from 'node:fs';\nimport { stat } from 'node:fs/promises';`)).toEqual([]);
        expect(writesOf(`import { readFile, writeFile } from 'node:fs/promises';`)).toEqual(['writeFile']);
        expect(writesOf(`import { mkdirSync as make } from 'fs';`)).toEqual(['mkdirSync']);
        expect(writesOf(`import * as fs from 'node:fs';`)).toEqual(['the whole of fs']);
        expect(writesOf(`const cache = new FilePageCache(dir);`)).toEqual(['FilePageCache']);
    });
});
