import { createStore, createResource, createSignal, type Getter } from 'azerothjs';

import { client } from '../api.ts';
import { GAMES, gameBySlug, type Game, type GameId } from '../data/games.ts';
import { TABLE_RULES, defaultTable, type TableConfig, type TableRules } from '../data/tables.ts';
import { createRandom, hashSeed } from '../lib/random.ts';
import { runtime } from '../lib/runtime.ts';

export interface LiveStats
{
    tablesOpen: number;
    playersOnline: number;
    waitSeconds: number;
}

/**
 * SIMULATED. These are not real counts - no table has ever been opened, because tables arrive
 * with the play domain. The numbers drift on a seeded RNG so the page feels alive during
 * development, and the moment `tables` exists the server answers with counts and this block and
 * `seededStats` below are deleted outright.
 *
 * Kept rather than zeroed because a home page reading "0 people at the tables" would be a
 * different lie: it would look like a broken product rather than an unbuilt feature.
 */
const BASE: Record<GameId, LiveStats> = {
    hokm: { tablesOpen: 42, playersOnline: 168, waitSeconds: 40 },
    poker: { tablesOpen: 31, playersOnline: 124, waitSeconds: 25 },
    backgammon: { tablesOpen: 77, playersOnline: 154, waitSeconds: 12 },
    ludo: { tablesOpen: 58, playersOnline: 190, waitSeconds: 20 }
};

export const STATS_DRIFT_MS = 6000;

export type GameStatus = 'available' | 'coming-soon' | 'disabled';

export interface CatalogueApi
{
    games: Game[];
    bySlug(slug: string): Game | undefined;
    byId(id: GameId): Game;
    rules(id: GameId): TableRules;
    defaults(id: GameId): TableConfig;
    stats(id: GameId): LiveStats;
    totals: Getter<{ tablesOpen: number; playersOnline: number }>;
    featured: Getter<GameId>;

    /** Whether a table of this game may be opened. The server decides; the client obeys. */
    status(id: GameId): GameStatus;

    /** True until the server's copy has landed. The local geometry is serving in the meantime. */
    loading: Getter<boolean>;
    refresh(): void;
    start(): () => void;
    stop(): void;
    reset(): void;
}

function seededStats(seed: number, tick: number): Record<GameId, LiveStats>
{
    const out = {} as Record<GameId, LiveStats>;
    for (const game of GAMES)
    {
        const random = createRandom(hashSeed(seed, 'stats', game.id, tick));
        const base = BASE[game.id];
        out[game.id] = {
            tablesOpen: Math.max(1, base.tablesOpen + random.int(-6, 6)),
            playersOnline: Math.max(2, base.playersOnline + random.int(-18, 18)),
            waitSeconds: Math.max(5, base.waitSeconds + random.int(-8, 8))
        };
    }
    return out;
}

/**
 * The catalogue is the one domain where a local copy is correct rather than a shortcut.
 *
 * `application/src/data/games.ts` carries where each table STANDS in the 3D market - `anchor`,
 * `rotation`, `table`, `set` - and the landing route is `render: 'static'`: it must paint the
 * market with no JavaScript and no server. So the geometry ships in the bundle, and the server
 * owns what a game IS: its seat counts, modes, targets, and whether it can be opened at all.
 *
 * The two are merged by id. Before the server answers, the local half serves alone and every
 * page renders; when it answers, the server's rules and status win. `server/tests/reference-
 * parity.spec.ts` fails if the halves ever disagree about a field they both hold.
 */
export const useCatalogue = createStore((): CatalogueApi =>
{
    const [tick, setTick] = createSignal(0);
    const [stats, setStats] = createSignal<Record<GameId, LiveStats>>(seededStats(runtime().seed, 0));
    let stop: (() => void) | null = null;

    const catalogue = createResource(
        () => client.catalogue.games(),
        { name: 'catalogue.games' }
    );

    /** Server rows by id, or an empty map before the first answer. */
    const published = (): Map<string, { status: GameStatus; rules: TableRules }> =>
    {
        const rows = catalogue.data()?.games ?? [];
        return new Map(rows.map((row) => [
            row.id,
            {
                status: row.status,
                rules: {
                    seats: row.rules.seats,
                    modes: row.rules.modes as TableRules['modes'],
                    targets: row.rules.targets,
                    fairness: row.rules.fairness,
                    stakes: row.rules.stakes,
                    partners: row.rules.partners
                }
            }
        ]));
    };

    const rulesFor = (id: GameId): TableRules => published().get(id)?.rules ?? TABLE_RULES[id];

    const drift = (): void =>
    {
        const next = tick() + 1;
        setTick(next);
        setStats(seededStats(runtime().seed, next));
    };

    return {
        games: GAMES,
        bySlug: gameBySlug,
        byId: (id) => GAMES.find((game) => game.id === id) ?? GAMES[0],
        rules: rulesFor,

        // Built from whichever rules are current, so a server that widens poker to ten seats
        // changes the create form's default without a client release.
        defaults: (id) =>
        {
            const rules = rulesFor(id);
            const base = defaultTable(id);
            return {
                ...base,
                seats: rules.seats[rules.seats.length - 1] ?? base.seats,
                target: rules.targets[0] ?? 0
            };
        },

        status: (id) => published().get(id)?.status ?? 'available',
        loading: () => catalogue.loading(),

        stats: (id) => stats()[id],
        totals: () =>
        {
            let tablesOpen = 0;
            let playersOnline = 0;
            for (const game of GAMES)
            {
                tablesOpen += stats()[game.id].tablesOpen;
                playersOnline += stats()[game.id].playersOnline;
            }
            return { tablesOpen, playersOnline };
        },
        featured: () => GAMES[Math.floor(runtime().clock.now() / (24 * 3600000)) % GAMES.length].id,

        refresh: drift,

        start()
        {
            if (stop === null)
            {
                const cancel = runtime().clock.every(STATS_DRIFT_MS, drift);
                stop = () =>
                {
                    cancel();
                    stop = null;
                };
            }
            return stop;
        },

        stop()
        {
            stop?.();
        },

        reset()
        {
            stop?.();
            setTick(0);
            setStats(seededStats(runtime().seed, 0));
        }
    };
});
