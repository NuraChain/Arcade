import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));

const main = readFileSync(join(HERE, '..', 'src', 'main.ts'), 'utf8');

const sweep = main.slice(main.indexOf('const suspensions ='), main.indexOf('suspensions.unref();'));

const shutdown = main.slice(main.indexOf('beforeShutdown:'), main.indexOf('beforeExit:'));

describe('what lifts a suspension that has run its time', () =>
{
    it('is the server, once a minute, on a timer that never holds the process open', () =>
    {
        expect(sweep).toMatch(/^const suspensions = setInterval\(\(\) =>$/m);
        expect(sweep).toMatch(/void ports\.jobs\.liftSuspensions\(\)/);
        expect(sweep).toMatch(/^\}, 60_000\);$/m);
        expect(main).toMatch(/^suspensions\.unref\(\);$/m);
    });

    it('says how many it lifted, and logs a sweep that failed without throwing it', () =>
    {
        expect(sweep).toMatch(/\.then\(\(lifted\) => \{ if \(lifted > 0\) \{ log\.info\('suspensions ran out', \{ lifted \}\); \} \}\)/);
        expect(sweep).toMatch(/\.catch\(\(error: unknown\) => log\.error\('suspension sweep failed', \{ error \}\)\);/);
    });

    it('is stopped on the way down with the other sweeps of the minute', () =>
    {
        expect(shutdown).toMatch(/clearInterval\(suspensions\);/);
        expect(shutdown.indexOf('clearInterval(suspensions)')).toBeLessThan(shutdown.indexOf('hub.closeAll('));
    });
});
