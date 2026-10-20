import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getMetadataArgsStorage } from 'typeorm';
import { describe, expect, it } from 'vitest';

import '../src/entities/index.ts';
import { VOICE_SCOPES, callOf, scopeFor } from '../src/domains/table/voices.ts';
import { tableCreateInput, voiceSwitch } from '../src/schemas.ts';
import { defaultTable } from '../../frontend/src/data/tables.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

const wordsIn = (check: string) =>
    [...(getMetadataArgsStorage().checks.find((one) => one.name === check)?.expression ?? '').matchAll(/'([a-z-]+)'/g)].map((match) => match[1]);

const body = { game: 'ludo', seats: 2, mode: 'live', privacy: 'public', target: 0, cube: false, blinds: 'low', chat: true, teams: false, invitees: [] };

describe('who a table\'s call is for', () =>
{
    it('is a word from one list, and the table, the wire and the list name the same ones', () =>
    {
        expect(wordsIn('tables_voice_known').sort()).toEqual([...VOICE_SCOPES].sort());

        for (const word of [...VOICE_SCOPES, 'side', 'on', 'true', ''])
        {
            const known = (VOICE_SCOPES as readonly string[]).includes(word);

            expect(tableCreateInput.safeParse({ ...body, voice: word }).ok, `opening with ${ word }`).toBe(known);
            expect(voiceSwitch.safeParse({ voice: word }).ok, `switching to ${ word }`).toBe(known);
        }
    });

    it('is not a yes or a no any more, when a table is opened or at its switch', () =>
    {
        expect(tableCreateInput.safeParse({ ...body, voice: true }).ok).toBe(false);
        expect(tableCreateInput.safeParse({ ...body, voice: false }).ok).toBe(false);
        expect(tableCreateInput.safeParse(body).ok).toBe(false);
        expect(voiceSwitch.safeParse({ on: true }).ok).toBe(false);
        expect(voiceSwitch.safeParse({ voice: true }).ok).toBe(false);
    });

    it('is off, the whole table, or a side of a table of two sides', () =>
    {
        expect([...VOICE_SCOPES]).toEqual(['off', 'table', 'team']);
        expect(wordsIn('tables_voice_team')).toEqual(['team']);
    });

    it('is the whole table where somebody asked for a side and the table has none', () =>
    {
        expect(scopeFor('team', false)).toBe('table');
        expect(scopeFor('team', true)).toBe('team');
        expect(scopeFor('table', true)).toBe('table');
        expect(scopeFor('off', true)).toBe('off');
    });

    it('names no call where there is none, the table\'s call for the table, and a call a side for a side', () =>
    {
        expect(callOf('off', 't-1', 0)).toBeNull();
        expect(callOf('table', 't-1', 1)).toBe('t-1');
        expect(callOf('team', 't-1', 0)).toBe('t-1#0');
        expect(callOf('team', 't-1', 1)).toBe('t-1#1');
        expect(callOf('team', 't-1', 0)).not.toBe(callOf('team', 't-1', 1));
    });

    it('is listed by a module that imports nothing, so the browser reads the same list', () =>
    {
        expect(readFileSync(join(HERE, '..', 'src', 'domains', 'table', 'voices.ts'), 'utf8')).not.toMatch(/^\s*import\s/m);
    });

    it('is off at a table nobody chose a call for', () =>
    {
        expect(defaultTable('ludo').voice).toBe('off');
        expect(defaultTable('hokm').voice).toBe('off');
    });
});
