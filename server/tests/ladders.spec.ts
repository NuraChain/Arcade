import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { GAME_SEEDS } from '../src/db/seed-reference.ts';
import { GAME_FAMILIES, GLOBAL_FAMILIES, RUNGS, familiesOf } from '../src/domains/achieve/families.ts';
import { dense, linear, measure, reached, rungId, tierAt, type GlobalFacts, type LadderFacts } from '../src/domains/achieve/ladders.ts';
import type { Draws, Engine } from '../src/domains/match/engine.ts';
import { ENGINES } from '../src/domains/match/service.ts';

const GAMES_PER_COUNT = 30;

const TIERS = ['bronze', 'silver', 'gold', 'platinum', 'diamond'];

function seeded(seed: number): { draws: Draws; next: () => number }
{
    let state = (seed * 2654435761) >>> 0 || 1;

    const next = (): number =>
    {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        return (state >>> 0) / 4294967296;
    };

    return { draws: { die: (sides) => 1 + Math.floor(next() * sides) }, next };
}

const NO_GLOBAL: GlobalFacts = {
    played: 0, won: 0, xp: 0, level: 1, days: 0, hosted: 0, opponents: 0, peak: 0, streak: 0, wonFull: 0, wonTurns: 0, wonLive: 0, wonDuel: 0
};

const facts = (over: Partial<LadderFacts> = {}): LadderFacts => ({
    played: 0,
    won: 0,
    xp: 0,
    days: 0,
    peak: 0,
    streak: 0,
    tallies: {},
    seats: {},
    pace: { live: { played: 0, won: 0 }, turns: { played: 0, won: 0 } },
    ...over
});

function talliesOf(engine: Engine): Set<string>
{
    const names = new Set<string>();

    for (const count of engine.seats)
    {
        for (let game = 0; game < GAMES_PER_COUNT; game += 1)
        {
            const { draws, next } = seeded(game * 131 + count);
            const seats = Array.from({ length: count }, (_, seat) => seat);
            let state = engine.create(seats, draws, { target: 0, cube: true, blinds: 'low' });
            const events: unknown[] = [];

            while (engine.finish(state) === null)
            {
                const legal = engine.legal(state, engine.turnOf(state)!);
                const applied = engine.apply(state, legal[Math.floor(next() * legal.length)], draws);

                if (!applied.ok)
                {
                    throw new Error(applied.reason);
                }

                state = applied.state;
                events.push(...applied.events);
            }

            for (const tally of engine.tally(events).values())
            {
                Object.keys(tally).forEach((name) => names.add(name));
            }
        }
    }

    return names;
}

describe('the ladders', () =>
{
    it('are a thousand for every game and a thousand for everywhere', () =>
    {
        for (const scope of [null, ...Object.keys(GAME_FAMILIES)])
        {
            expect(RUNGS.filter((rung) => rung.game === scope), String(scope)).toHaveLength(1000);
        }

        expect(Object.keys(GAME_FAMILIES).sort()).toEqual(ENGINES.map((engine) => engine.id).sort());
    });

    it('give every rung an id that fits the column and names its scope, family and step', () =>
    {
        for (const rung of RUNGS)
        {
            expect(rung.id).toBe(rungId(rung.game, rung.family, rung.step));
            expect(rung.id.length).toBeLessThanOrEqual(64);
            expect(rung.blurbEn).not.toContain('{n}');
            expect(rung.blurbFa).not.toContain('{n}');
        }
    });

    it('say a first rung in the singular rather than as "1 games"', () =>
    {
        for (const rung of RUNGS.filter((one) => one.need === 1))
        {
            expect(rung.blurbEn, rung.id).not.toMatch(/\b1\b/);
        }
    });

    it('climb strictly, from bronze to diamond', () =>
    {
        for (const scope of [null, ...Object.keys(GAME_FAMILIES)])
        {
            for (const family of familiesOf(scope))
            {
                const rungs = RUNGS.filter((rung) => rung.game === scope && rung.family === family.id);
                const tiers = rungs.map((rung) => TIERS.indexOf(rung.tier));

                expect(family.steps.every((need, index) => index === 0 || need > family.steps[index - 1]), family.id).toBe(true);
                expect(family.steps[0]).toBeGreaterThan(0);
                expect(tiers[0]).toBe(0);
                expect(tiers.at(-1)).toBe(4);
                expect(tiers.every((tier, index) => index === 0 || tier >= tiers[index - 1])).toBe(true);
            }
        }
    });

    it('never offer a seat count or a pace the game cannot be played at', () =>
    {
        for (const [game, families] of Object.entries(GAME_FAMILIES))
        {
            const seed = GAME_SEEDS.find((one) => one.id === game)!;

            for (const family of families)
            {
                if (family.metric.of === 'wonAt' || family.metric.of === 'playedAt')
                {
                    expect(seed.seats, `${ game } ${ family.id }`).toContain(family.metric.seats);
                }

                if (family.metric.of === 'wonIn' || family.metric.of === 'playedIn')
                {
                    expect(seed.modes, `${ game } ${ family.id }`).toContain(family.metric.pace);
                }
            }
        }
    });

    it('draw every icon from the registry the client ships', () =>
    {
        const registry = ['registry.ts', 'all.ts'].map((file) => readFileSync(new URL(`../../application/src/icons/${ file }`, import.meta.url), 'utf8')).join('\n');

        for (const icon of new Set(RUNGS.map((rung) => rung.icon)))
        {
            expect(registry, icon).toContain(`'${ icon }':`);
        }
    });
});

describe.each(ENGINES.map((engine) => [engine.id, engine] as const))('the %s ladders', (id, engine: Engine) =>
{
    it('count only what the engine really tallies', () =>
    {
        const kept = talliesOf(engine);

        for (const family of GAME_FAMILIES[id])
        {
            if (family.metric.of === 'tally')
            {
                expect(kept, family.metric.name).toContain(family.metric.name);
            }
        }
    }, 120_000);
});

describe('building a ladder', () =>
{
    it('walks one by one to twenty and then by the round numbers', () =>
    {
        expect(dense(25)).toEqual([...linear(1, 1, 20), 25, 30, 35, 40, 45]);
        expect(dense(3, 50)).toEqual([50, 100, 150]);
        expect(dense(40).slice(34)).toEqual([95, 100, 110, 120, 130, 140]);
    });

    it('refuses a ladder longer than the bands', () =>
    {
        expect(() => dense(1000)).toThrow();
    });

    it('splits tiers by where a rung stands in its ladder', () =>
    {
        expect([0, 29, 30, 54, 55, 77, 78, 92, 93, 99].map((index) => tierAt(index, 100)))
            .toEqual(['bronze', 'bronze', 'silver', 'silver', 'gold', 'gold', 'platinum', 'platinum', 'diamond', 'diamond']);
    });

    it('reaches a rung exactly at its need and not a point before', () =>
    {
        expect(reached([1, 2, 5], 0)).toBe(0);
        expect(reached([1, 2, 5], 4)).toBe(2);
        expect(reached([1, 2, 5], 5)).toBe(3);
        expect(reached([1, 2, 5], 500)).toBe(3);
    });
});

describe('measuring a record', () =>
{
    it('reads a seat count, a pace and a tally from the game and a cross-game fact from everywhere', () =>
    {
        const record = facts({
            won: 3,
            tallies: { captures: 7 },
            seats: { 4: { played: 5, won: 2 } },
            pace: { live: { played: 1, won: 1 }, turns: { played: 4, won: 2 } }
        });
        const global = { ...NO_GLOBAL, wonFull: 9 };

        expect(measure(record, global, { of: 'won' })).toBe(3);
        expect(measure(record, global, { of: 'tally', name: 'captures' })).toBe(7);
        expect(measure(record, global, { of: 'tally', name: 'home' })).toBe(0);
        expect(measure(record, global, { of: 'wonAt', seats: 4 })).toBe(2);
        expect(measure(record, global, { of: 'playedAt', seats: 2 })).toBe(0);
        expect(measure(record, global, { of: 'playedIn', pace: 'turns' })).toBe(4);
        expect(measure(record, global, { of: 'global', name: 'wonFull' })).toBe(9);
    });

    it('asks every cross-game family of the cross-game facts', () =>
    {
        for (const family of GLOBAL_FAMILIES)
        {
            expect(family.metric.of, family.id).toBe('global');
        }
    });
});
