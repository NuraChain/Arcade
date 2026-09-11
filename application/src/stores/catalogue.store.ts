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

    status(id: GameId): GameStatus;

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

export const useCatalogue = createStore((): CatalogueApi =>
{
    const [tick, setTick] = createSignal(0);
    const [stats, setStats] = createSignal<Record<GameId, LiveStats>>(seededStats(runtime().seed, 0));
    let stop: (() => void) | null = null;

    const catalogue = createResource(
        () => client.catalogue.games(),
        { name: 'catalogue.games' }
    );

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
