import 'reflect-metadata';
import { describe, expect, it } from 'vitest';

import type { Draws, Engine, ForfeitReason } from '../src/domains/match/engine.ts';
import { ENGINES, FOLD_MAX, sameTurn } from '../src/domains/match/service.ts';
import { sideOf, variantOf, type Format, type Variant } from '../src/domains/match/sides.ts';
import type { RefusalWord } from '../src/domains/match/refusals.ts';
import type { BackgammonRefusal } from '../src/domains/match/backgammon/state.ts';
import type { HokmRefusal } from '../src/domains/match/hokm/state.ts';
import type { PokerRefusal } from '../src/domains/match/poker/state.ts';
import type { RefusalReason } from '../src/domains/match/ludo/state.ts';
import { GAME_SEEDS } from '../src/db/seed-reference.ts';
import { teamsOf } from '../src/domains/table/teams.ts';
import { matchBoard, matchLog, matchPlay } from '../src/schemas.ts';

const GAMES_PER_FORMAT = 12;

const CLOCK_GAMES = 4;

const UNBOUND = 10_000;

const BOUND: Readonly<Record<string, Readonly<Partial<Record<Variant, number>>>>> = {
    ludo: { standard: 6000 },
    hokm: { standard: 4000, teams: 4000 },
    backgammon: { standard: 3000 },
    poker: { standard: 20_000 }
};

const boundOf = (engine: Engine, format: Format) => BOUND[engine.id]?.[format.variant] ?? UNBOUND;

const nameOf = (format: Format) => `${ format.seats }-seat ${ format.variant }`;

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

function eachState(engine: Engine, format: Format, game: number, visit: (state: unknown, actions: number) => void)
{
    const { draws, next } = seeded(game * 53 + format.seats * 7 + 1);
    const seats = Array.from({ length: format.seats }, (_, seat) => seat);
    let state = engine.create(seats, draws, { target: 0, cube: true, blinds: 'low', variant: format.variant }).state;
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

        expect(actions).toBeLessThan(boundOf(engine, format));
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

describe('the sides of a format', () =>
{
    it('are two pairs sitting opposite in a team game, and a seat each in any other', () =>
    {
        expect([0, 1, 2, 3].map((seat) => sideOf(seat, { seats: 4, variant: 'teams' }))).toEqual([0, 1, 0, 1]);

        for (const seats of [2, 3, 4, 6, 9])
        {
            const all = Array.from({ length: seats }, (_, seat) => seat);

            expect(all.map((seat) => sideOf(seat, { seats, variant: 'standard' })), `${ seats } seats`).toEqual(all);
        }
    });
});

describe.each(ENGINES.map((engine) => [engine.id, engine] as const))('the %s engine keeps the contract', (_id, engine: Engine) =>
{
    it('offers every format the catalogue seeds', () =>
    {
        const seeded = GAME_SEEDS.find((game) => game.id === engine.id);

        expect(seeded).toBeDefined();

        for (const seats of seeded!.seats)
        {
            for (const asked of [false, true])
            {
                const format: Format = { seats, variant: variantOf(teamsOf(seeded!.partners, seats, asked)) };

                expect(engine.formats, `${ engine.id } does not play ${ nameOf(format) }`).toContainEqual(format);
            }
        }
    });

    it('splits every format it plays into at least two sides, every seat on the side the shared sides give it', () =>
    {
        for (const format of engine.formats)
        {
            const sides = Array.from({ length: format.seats }, (_, seat) => engine.sideOf(seat, format));

            expect(sides, nameOf(format)).toEqual(sides.map((_, seat) => sideOf(seat, format)));
            expect(new Set(sides).size, nameOf(format)).toBeGreaterThanOrEqual(2);
        }
    });

    it('counts engagement only in verbs a player can send it, and after at least one', () =>
    {
        for (const format of engine.formats)
        {
            const { verbs, after } = engine.engagement(format);

            expect(verbs.length).toBeGreaterThan(0);
            expect(Number.isInteger(after) && after >= 1, `${ nameOf(format) }: after ${ after }`).toBe(true);

            for (const verb of verbs)
            {
                expect(() => matchPlay.parse({ kind: engine.id, verb }), `${ engine.id } has no verb ${ verb }`).not.toThrow();
            }
        }
    });

    for (const format of engine.formats)
    {
        it(`ends every ${ nameOf(format) } turn the sweep plays out within FOLD_MAX steps of autoplay`, () =>
        {
            for (let game = 0; game < CLOCK_GAMES; game += 1)
            {
                const fold = seeded(game * 131 + format.seats).draws;

                eachState(engine, format, game, (state, actions) =>
                {
                    expect(foldFrom(engine, state, fold), `the turn at action ${ actions }`).toBeLessThanOrEqual(FOLD_MAX);
                });
            }
        }, 60_000);

        it(`leaves the ${ nameOf(format) } turn alone when a seat not on turn forfeits and nothing else moves`, () =>
        {
            for (let game = 0; game < CLOCK_GAMES; game += 1)
            {
                eachState(engine, format, game, (state, actions) =>
                {
                    const turn = engine.turnOf(state)!;

                    for (let seat = 0; seat < format.seats; seat += 1)
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

    for (const format of engine.formats)
    {
        it(`plays random ${ nameOf(format) } games to a finish without once breaking a rule of the seam`, () =>
        {
            for (let game = 0; game < GAMES_PER_FORMAT; game += 1)
            {
                const { draws, next } = seeded(game * 97 + format.seats);
                const seats = Array.from({ length: format.seats }, (_, seat) => seat);
                let state = engine.create(seats, draws, { target: 0, cube: true, blinds: 'low', variant: format.variant }).state;
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

                    expect(actions).toBeLessThan(boundOf(engine, format));
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
                const sideAt = (seat: number) => engine.sideOf(seat, format);

                expect(ending.winners.length, 'a finish named no winner').toBeGreaterThan(0);

                if (format.variant === 'teams')
                {
                    expect(seats.map(sideAt), 'partners do not sit opposite each other').toEqual([0, 1, 0, 1]);
                    expect([placeOf(2), placeOf(3)], 'partners were placed apart').toEqual([placeOf(0), placeOf(1)]);
                }

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
                    const better = new Set(seats.filter((other) => placeOf(other) < placeOf(seat)).map(sideAt));

                    expect(placeOf(seat), `seat ${ seat } is not competition-ranked`).toBe(1 + better.size);

                    for (const partner of seats.filter((other) => sideAt(other) === sideAt(seat)))
                    {
                        expect(placeOf(partner), `partners ${ seat } and ${ partner } were placed apart`).toBe(placeOf(seat));
                    }
                }

                for (const [index, quit] of forfeits.entries())
                {
                    const later = new Set(forfeits.slice(index + 1).map((one) => one.seat));

                    for (const stayed of quit.staying.filter((seat) => sideAt(seat) !== sideAt(quit.seat)))
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
