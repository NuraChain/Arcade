import 'reflect-metadata';
import { describe, expect, it } from 'vitest';

import type { Draws, Engine, ForfeitReason } from '../src/domains/match/engine.ts';
import { ENGINES, FOLD_MAX, sameTurn } from '../src/domains/match/service.ts';
import type { RefusalWord } from '../src/domains/match/refusals.ts';
import type { BackgammonRefusal } from '../src/domains/match/backgammon/state.ts';
import type { HokmRefusal } from '../src/domains/match/hokm/state.ts';
import type { PokerRefusal } from '../src/domains/match/poker/state.ts';
import type { RefusalReason } from '../src/domains/match/ludo/state.ts';
import { GAME_SEEDS } from '../src/db/seed-reference.ts';
import { matchBoard, matchLog, matchPlay } from '../src/schemas.ts';

const GAMES_PER_COUNT = 12;

const CLOCK_GAMES = 4;

const BOUND: Readonly<Record<string, number>> = { ludo: 6000, hokm: 4000, backgammon: 3000, poker: 20_000 };

const REASONS: readonly ForfeitReason[] = ['timeout', 'resign', 'left'];

const PROBE: Draws = { die: () => 1 };

interface Forfeit
{
    seat: number;
    staying: number[];
}

function seeded(seed: number): { draws: Draws; next: () => number }
{
    let state = (seed * 2654435761) >>> 0 || 1;

    const next = () =>
    {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        return (state >>> 0) / 4294967296;
    };

    return { draws: { die: (sides) => 1 + Math.floor(next() * sides) }, next };
}

const revOf = (state: unknown) => (state as { rev: number }).rev;

function eachState(engine: Engine, count: number, game: number, visit: (state: unknown, actions: number) => void)
{
    const { draws, next } = seeded(game * 53 + count * 7 + 1);
    const seats = Array.from({ length: count }, (_, seat) => seat);
    let state = engine.create(seats, draws, { target: 0, cube: true, blinds: 'low' }).state;
    let actions = 0;

    while (engine.finish(state) === null)
    {
        visit(state, actions);

        const legal = engine.legal(state, engine.turnOf(state)!);
        const applied = engine.apply(state, legal[Math.floor(next() * legal.length)], draws);

        expect(applied.ok, `apply at action ${ actions }`).toBe(true);

        if (!applied.ok)
        {
            return;
        }

        state = applied.state;
        actions += 1;

        expect(actions).toBeLessThan(BOUND[engine.id] ?? 10_000);
    }
}

function foldFrom(engine: Engine, state: unknown, draws: Draws)
{
    const seat = engine.turnOf(state)!;
    let current = state;
    let steps = 0;

    while (steps <= FOLD_MAX && (steps === 0 || (engine.finish(current) === null && sameTurn(engine, state, current))))
    {
        const action = engine.autoplay(current, seat, draws);

        expect(action, `autoplay ${ steps } steps into a turn`).not.toBeNull();

        const applied = engine.apply(current, action, draws);

        expect(applied.ok, `autoplay applied ${ steps } steps into a turn`).toBe(true);

        if (!applied.ok)
        {
            break;
        }

        current = applied.state;
        steps += 1;
    }

    return steps;
}

/**
 * Every reason an engine can refuse with has words of its own. An unlisted one still answers - as
 * "That move is not allowed." - but hokm's reasons were unlisted for a whole release and every one
 * of them told a card player their TOKEN could not move there. Checked by the compiler, because the
 * reasons are type unions and nothing about them exists at runtime to iterate.
 */
type Unworded = Exclude<RefusalReason | HokmRefusal | BackgammonRefusal | PokerRefusal, RefusalWord>;

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

    it('splits every seat count it plays into at least two sides, every seat on exactly one', () =>
    {
        for (const count of engine.seats)
        {
            const sides = Array.from({ length: count }, (_, seat) => engine.sideOf(seat, count));

            for (const side of sides)
            {
                expect(Number.isInteger(side) && side >= 0, `${ count } seats: side ${ side }`).toBe(true);
            }

            expect(new Set(sides).size, `${ count } seats`).toBeGreaterThanOrEqual(2);
        }
    });

    it('counts engagement only in verbs a player can send it, and after at least one', () =>
    {
        for (const count of engine.seats)
        {
            const { verbs, after } = engine.engagement(count);

            expect(verbs.length).toBeGreaterThan(0);
            expect(Number.isInteger(after) && after >= 1, `${ count } seats: after ${ after }`).toBe(true);

            for (const verb of verbs)
            {
                expect(() => matchPlay.parse({ kind: engine.id, verb }), `${ engine.id } has no verb ${ verb }`).not.toThrow();
            }
        }
    });

    for (const count of engine.seats)
    {
        it(`ends every ${ count }-seat turn the sweep plays out within FOLD_MAX steps of autoplay`, () =>
        {
            for (let game = 0; game < CLOCK_GAMES; game += 1)
            {
                const fold = seeded(game * 131 + count).draws;

                eachState(engine, count, game, (state, actions) =>
                {
                    expect(foldFrom(engine, state, fold), `the turn at action ${ actions }`).toBeLessThanOrEqual(FOLD_MAX);
                });
            }
        }, 60_000);

        it(`leaves the turn alone at ${ count } seats when a seat not on turn forfeits and nothing else moves`, () =>
        {
            for (let game = 0; game < CLOCK_GAMES; game += 1)
            {
                eachState(engine, count, game, (state, actions) =>
                {
                    const turn = engine.turnOf(state)!;

                    for (let seat = 0; seat < count; seat += 1)
                    {
                        const applied = seat === turn ? null : engine.apply(state, engine.forfeit(seat, 'resign'), PROBE);

                        if (applied === null || !applied.ok || engine.finish(applied.state) !== null || applied.events.length > 1)
                        {
                            continue;
                        }

                        expect(engine.turnOf(applied.state), `seat ${ seat } forfeiting at action ${ actions }`).toBe(turn);
                        expect(engine.turnKey(applied.state), `seat ${ seat } forfeiting at action ${ actions }`).toBe(engine.turnKey(state));
                    }
                });
            }
        }, 60_000);
    }

    for (const count of engine.seats)
    {
        it(`plays random ${ count }-seat games to a finish without once breaking a rule of the seam`, () =>
        {
            for (let game = 0; game < GAMES_PER_COUNT; game += 1)
            {
                const { draws, next } = seeded(game * 97 + count);
                const seats = Array.from({ length: count }, (_, seat) => seat);
                let state = engine.create(seats, draws, { target: 0, cube: true, blinds: 'low' }).state;
                const events: unknown[] = [];
                const forfeits: Forfeit[] = [];
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

                    const quitting = next() < 0.02;
                    const playing = quitting ? seats.filter((seat) => engine.apply(state, engine.forfeit(seat, 'resign'), PROBE).ok) : [];
                    const quitter = playing[Math.floor(next() * playing.length)] ?? turn!;

                    if (quitting)
                    {
                        forfeits.push({ seat: quitter, staying: playing.filter((seat) => seat !== quitter) });
                    }

                    const chosen = quitting
                        ? engine.forfeit(quitter, REASONS[Math.floor(next() * REASONS.length)])
                        : legal[Math.floor(next() * legal.length)];
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

                const ending = engine.finish(state)!;
                const quitters = new Set(forfeits.map((one) => one.seat));
                const places = new Map(engine.standings(state).map((one) => [one.seat, one.place]));
                const placeOf = (seat: number) => places.get(seat)!;
                const sideOf = (seat: number) => engine.sideOf(seat, count);

                expect(ending.winners.length, 'a finish named no winner').toBeGreaterThan(0);

                for (const seat of [...ending.winners, ...ending.unsettled])
                {
                    expect(seats).toContain(seat);
                    expect(quitters.has(seat), `seat ${ seat } forfeited and is still a winner or in play`).toBe(false);
                }

                for (const seat of ending.trailing)
                {
                    expect(ending.unsettled, `seat ${ seat } trails but is not still in play`).toContain(seat);
                }

                for (const seat of seats)
                {
                    const better = new Set(seats.filter((other) => placeOf(other) < placeOf(seat)).map(sideOf));

                    expect(placeOf(seat), `seat ${ seat } is not competition-ranked`).toBe(1 + better.size);

                    for (const partner of seats.filter((other) => sideOf(other) === sideOf(seat)))
                    {
                        expect(placeOf(partner), `partners ${ seat } and ${ partner } were placed apart`).toBe(placeOf(seat));
                    }
                }

                for (const [index, quit] of forfeits.entries())
                {
                    const later = new Set(forfeits.slice(index + 1).map((one) => one.seat));

                    for (const stayed of quit.staying.filter((seat) => sideOf(seat) !== sideOf(quit.seat)))
                    {
                        if (later.has(stayed))
                        {
                            expect(placeOf(stayed), `seat ${ stayed } left later and was placed below ${ quit.seat }`).toBeLessThanOrEqual(placeOf(quit.seat));
                        }
                        else
                        {
                            expect(placeOf(stayed), `seat ${ quit.seat } forfeited and was placed level with or above ${ stayed }`).toBeLessThan(placeOf(quit.seat));
                        }
                    }
                }

                for (const tally of engine.tally(events).values())
                {
                    expect(engine.points(tally)).toBeGreaterThanOrEqual(0);
                }
            }
        }, 60_000);
    }
});
