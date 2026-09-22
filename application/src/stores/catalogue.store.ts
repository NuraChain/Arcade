import { createStore, createResource, type Getter } from 'azerothjs';

import { client } from '../api.ts';
import { GAMES, gameBySlug, type Game, type GameId } from '../data/games.ts';
import { TABLE_RULES, defaultTable, type TableConfig, type TableRules } from '../data/tables.ts';
import { runtime } from '../lib/runtime.ts';

/**
 * How busy each game is, COUNTED.
 *
 * This store used to drift two numbers per game on a seeded RNG from a table of literals - "627
 * people at the tables right now" on a product where no table had ever been opened - and the rule
 * written beside them was that they would be deleted outright the moment the server answered with
 * real counts. `GET /catalogue/live` is that answer, so `BASE`, `seededStats` and the six-second
 * drift are gone.
 *
 * `waitSeconds` went with them and is not coming back as a zero. Nothing measures how long somebody
 * waits for a chair - matchmaking is a query over open tables, not a queue with a length - so a
 * number there would be the same invention wearing a smaller hat. The copy that showed it is gone
 * too, because a sentence with a hole in it is worse than no sentence.
 *
 * Zeroes are the honest answer for a quiet game and they are rendered as such. "No tables open"
 * reads as a quiet evening; a made-up 58 reads as a lie the first time somebody clicks through and
 * finds nothing there.
 */

export interface LiveStats
{
    tablesOpen: number;
    playersOnline: number;
}

/**
 * How often the counts are re-read while somebody is looking at them.
 *
 * Slower than the six seconds the simulation used, because this is a real request rather than a
 * local RNG and "how busy is it" does not change meaningfully in six seconds. It is a poll rather
 * than a realtime frame on purpose: `social` already fans presence to every socket on the server
 * and adding a table count to it would make every seat claim anywhere a broadcast to everybody.
 */
export const LIVE_REFRESH_MS = 30_000;

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

const QUIET: LiveStats = { tablesOpen: 0, playersOnline: 0 };

export const useCatalogue = createStore((): CatalogueApi =>
{
    let stop: (() => void) | null = null;

    const catalogue = createResource(
        () => client.catalogue.games(),
        { name: 'catalogue.games' }
    );

    const live = createResource(
        () => client.catalogue.live(),
        { name: 'catalogue.live' }
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
                    stakes: row.rules.stakes,
                    partners: row.rules.partners
                }
            }
        ]));
    };

    const rulesFor = (id: GameId): TableRules => published().get(id)?.rules ?? TABLE_RULES[id];

    const counts = (): Map<string, LiveStats> => new Map(
        (live.data()?.games ?? []).map((row) => [row.game, { tablesOpen: row.tables, playersOnline: row.playing }])
    );

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

        stats: (id) => counts().get(id) ?? QUIET,

        totals: () =>
        {
            let tablesOpen = 0;
            let playersOnline = 0;

            for (const row of counts().values())
            {
                tablesOpen += row.tablesOpen;
                playersOnline += row.playersOnline;
            }

            return { tablesOpen, playersOnline };
        },

        /**
         * The game of the day, and only ever one somebody can actually play.
         *
         * It rotated over the whole catalogue, which was right while every game was available and
         * became a trap the moment three of them were not: `featured()` is what the sidebar's Quick
         * play and a group's "Play together" reach for when no game was named, so on three days in
         * four the product's most prominent button opened a table the server refuses.
         *
         * Falls back to the whole list rather than to nothing, because a catalogue that has not
         * loaded yet says every game is available - and a featured game that is briefly wrong is a
         * smaller failure than a home page with no game at all.
         */
        featured: () =>
        {
            const open = GAMES.filter((game) => (published().get(game.id)?.status ?? 'available') === 'available');
            const from = open.length > 0 ? open : GAMES;

            return from[Math.floor(runtime().clock.now() / (24 * 3600000)) % from.length].id;
        },

        refresh: () => live.refetch(),

        start()
        {
            if (stop === null)
            {
                const cancel = runtime().clock.every(LIVE_REFRESH_MS, () => live.refetch());
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
            void catalogue.refetch();
            void live.refetch();
        }
    };
});
