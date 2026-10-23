import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));

const main = readFileSync(join(HERE, '..', 'src', 'main.ts'), 'utf8');

const hooks = main.slice(main.indexOf('const hub = createHub('), main.indexOf('report: (error, where)'));

describe('what writes down when somebody was last seen', () =>
{
    it('is the domain\'s own write, at once, the moment the hub says somebody left', () =>
    {
        expect(hooks).toMatch(/leaving: \(ids\) =>\s*\{\s*void social\.lastSeen\(ids\)\.catch\(/);
    });

    it('is the coalesced touch for whoever the hub still holds', () =>
    {
        expect(hooks).toMatch(/touchSeen: \(ids\) =>\s*\{\s*void social\.touchSeen\(ids\)\.catch\(/);
    });
});
