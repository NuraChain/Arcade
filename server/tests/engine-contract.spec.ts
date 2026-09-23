import 'reflect-metadata';
import { describe, expect, it } from 'vitest';

import type { Draws, Engine } from '../src/domains/match/engine.ts';
import { ENGINES } from '../src/domains/match/service.ts';
import type { REFUSALS } from '../src/domains/match/service.ts';
import type { BackgammonRefusal } from '../src/domains/match/backgammon/state.ts';
import type { HokmRefusal } from '../src/domains/match/hokm/state.ts';
import type { RefusalReason } from '../src/domains/match/ludo/state.ts';
import { GAME_SEEDS } from '../src/db/seed-reference.ts';
import { matchBoard, matchLog } from '../src/schemas.ts';

const GAMES_PER_COUNT = 12;

const BOUND: Readonly<Record<string, number>> = { ludo: 6000, hokm: 4000, backgammon: 3000, poker: 20_000 };

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

const revOf = (state: unknown): number => (state as { rev: number }).rev;

/**
 * Every reason an engine can refuse with has words of its own. An unlisted one still answers - as
 * "That move is not allowed." - but hokm's reasons were unlisted for a whole release and every one
 * of them told a card player their TOKEN could not move there. Checked by the compiler, because the
 * reasons are type unions and nothing about them exists at runtime to iterate.
 */
type Unworded = Exclude<RefusalReason | HokmRefusal | BackgammonRefusal, keyof typeof REFUSALS>;

describe('the refusals', () =>
{
    it('have words for every reason an engine gives', () =>
    {
        const everyReasonWorded: [Unworded] extends [never] ? true : false = true;

        expect(everyReasonWorded).toBe(true);
    });
});

describe.each(ENGINES.map((engine) => [engine.id, engine] as const))('the %s engine keeps the contract', (_id, engine: Engine) =>
{
    it('offers every seat count the catalogue seeds', () =>
    {
        const seeded = GAME_SEEDS.find((game) => game.id === engine.id);

        expect(seeded).toBeDefined();

        for (const seats of seeded!.seats)
        {
            expect(engine.seats).toContain(seats);
        }
    });

    for (const count of engine.seats)
    {
        it(`plays random ${ count }-seat games to a finish without once breaking a rule of the seam`, () =>
        {
            for (let game = 0; game < GAMES_PER_COUNT; game += 1)
            {
                const { draws, next } = seeded(game * 97 + count);
                const seats = Array.from({ length: count }, (_, seat) => seat);
                let state = engine.create(seats, draws, { target: 0, cube: true, blinds: 'low' });
                const events: unknown[] = [];
                let actions = 0;

                while (engine.finish(state) === null)
                {
                    const turn = engine.turnOf(state);

                    expect(turn, `turn at action ${ actions }`).not.toBeNull();

                    const legal = engine.legal(state, turn!);
                    const auto = engine.autoplay(state, turn!, draws);

                    expect(legal.length, `legal moves at action ${ actions }`).toBeGreaterThan(0);
                    expect(auto, `autoplay at action ${ actions }`).not.toBeNull();
                    expect(legal).toContainEqual(auto);

                    const chosen = next() < 0.02 ? engine.forfeit(turn!, 'timeout') : legal[Math.floor(next() * legal.length)];
                    const before = revOf(state);
                    const applied = engine.apply(state, chosen, draws);

                    expect(applied.ok, `apply at action ${ actions }`).toBe(true);

                    if (!applied.ok)
                    {
                        return;
                    }

                    state = applied.state;
                    events.push(...applied.events);

                    expect(revOf(state)).toBe(before + 1);

                    if (actions % 40 === 0)
                    {
                        for (const reader of [...seats, null])
                        {
                            matchBoard.parse(engine.view(state, reader));
                            matchLog.parse(engine.log(events, reader));
                        }
                    }

                    actions += 1;

                    expect(actions).toBeLessThan(BOUND[engine.id] ?? 10_000);
                }

                for (const reader of [...seats, null])
                {
                    matchBoard.parse(engine.view(state, reader));
                    matchLog.parse(engine.log(events, reader));
                }

                expect(engine.standings(state).map((place) => place.seat).sort()).toEqual(seats);

                for (const tally of engine.tally(events).values())
                {
                    expect(engine.points(tally)).toBeGreaterThanOrEqual(0);
                }
            }
        }, 60_000);
    }
});
