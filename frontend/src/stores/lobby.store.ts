import { createStore, createResource, createSignal, untrack, type Getter } from 'azerothjs';

import { ApiError, client, type TableSummary } from '../api.ts';
import type { GameId } from '../data/games.ts';
import type { TableConfig } from '../data/tables.ts';
import type { QuickAsk } from '../lib/quick-asks.ts';
import { runtime } from '../lib/runtime.ts';
import { useAccount } from './account.store.ts';
import { useCatalogue } from './catalogue.store.ts';
import { useRealtime } from './realtime.store.ts';
import { teamsOf } from '../../../backend/src/domains/table/teams.ts';

export interface LobbyApi
{
    /** The table this page is showing, or null. */
    table: Getter<TableSummary | null>;
    loading: Getter<boolean>;
    failed: Getter<unknown>;

    /** Where this account is sitting right now. Survives a reload and a second device. */
    seated: Getter<TableSummary[]>;

    waiting: Getter<TableSummary[]>;

    open(tableId: string): void;
    close(): void;
    openId: Getter<string>;

    /** My handle, for telling my own chair from everyone else's. */
    me: Getter<string>;

    /** Opens a private table and sits down. Answers with its id. */
    host(game: GameId, config: TableConfig, invitees: readonly string[]): Promise<string>;

    /**
     * Sits down at an open table for this game, opening one if there is none.
     *
     * Answers with the table's id either way, so the caller navigates to the same place whether
     * somebody was already waiting or nobody was.
     */
    quick(game: GameId, ask?: QuickAsk): Promise<string>;

    finding: Getter<readonly GameId[]>;

    /** Takes a chair. Null means the table filled up first - an answer, not a failure. */
    claim(tableId: string): Promise<number | null>;

    leave(tableId: string, forfeit: boolean): Promise<void>;
    ready(tableId: string, ready: boolean): Promise<void>;
    invite(tableId: string, handle: string): Promise<void>;
    end(tableId: string): Promise<void>;
    setVoice(tableId: string, voice: TableConfig['voice']): Promise<void>;

    /** Deals the board. Any seated player may, once every chair is taken and everybody is ready. */
    begin(tableId: string): Promise<void>;

    again(tableId: string): Promise<void>;

    refresh(): Promise<void>;
    start(): () => void;
    stop(): void;
    reset(): void;
}

export const ARRIVAL_MS = 10_000;

/**
 * Tables, according to the SERVER.
 *
 * This store used to be a simulation: it invented opponents on a timer, typed their chatter from a
 * script, rolled dice nobody threw and declared a winner nobody beat. Every one of those is gone.
 * A table now holds seats, people sit in them, and it stops there - because there is no game
 * engine behind it and a store that pretended otherwise would be the only thing in the product
 * still telling that story.
 *
 * What replaces the ambient timers is the doorbell: somebody takes a chair, the server rings, and
 * this re-reads the table through the route that already decides who may see it.
 */
export const useLobby = createStore((): LobbyApi =>
{
    const account = useAccount();
    const catalogue = useCatalogue();

    const who = () => account.user()?.id ?? null;

    const [openId, setOpenId] = createSignal('');

    const [finding, setFinding] = createSignal<readonly GameId[]>([]);

    const searches = new Map<GameId, Promise<string>>();

    const arriving = new Map<string, () => void>();

    const done = (game: GameId) =>
    {
        searches.delete(game);
        setFinding((current) => current.filter((one) => one !== game));
    };

    let unhold: (() => void) | null = null;
    let asked = 0;

    const wired = (table: TableSummary) => table.mode === 'live'
        && table.status !== 'closed'
        && (table.matchId !== undefined || table.chairs.some((chair) => chair.seat === table.mine && chair.ready));

    const rehold = (tables: readonly TableSummary[]) =>
    {
        const next = tables.some(wired) ? useRealtime().hold() : null;

        unhold?.();
        unhold = next;
    };

    const seated = createResource(who, async () =>
    {
        const turn = asked += 1;
        const answer = await client.tables.mine();

        if (turn === asked)
        {
            rehold(answer.tables);
        }

        return answer;
    }, { name: 'tables.mine' });

    const left = new Set<string>();

    const viewing = createResource(
        () => (openId() === '' ? null : { id: openId(), who: who() }),
        async (current) =>
        {
            if (left.has(current.id))
            {
                return null;
            }

            try
            {
                return await client.tables.view({ params: { id: current.id } });
            }
            catch (error)
            {
                // A table nobody opened - or one that closed and was swept - is an answer rather
                // than a failure to load. The page says so instead of offering to retry.
                if (error instanceof ApiError && error.status === 404)
                {
                    return null;
                }
                throw error;
            }
        },
        { name: 'tables.view' }
    );

    let inFlight: Promise<void> = Promise.resolve();

    const revalidate = () =>
    {
        inFlight = inFlight.catch(() => undefined).then(async () =>
        {
            const open = untrack(openId);
            const held = untrack(viewing.data) ?? null;

            if (open !== '' && held !== null && held.id === open && held.mine !== undefined && held.privacy !== 'public')
            {
                await seated.refetch();

                if (!(untrack(seated.data)?.tables ?? []).some((table) => table.id === open))
                {
                    left.add(open);
                }

                await viewing.refetch();
                return;
            }

            await Promise.all([
                seated.refetch(),
                open === '' ? Promise.resolve() : viewing.refetch()
            ]);
        });
        return inFlight;
    };

    interface TableInput
    {
        game: string;
        seats: number;
        mode: TableConfig['mode'];
        privacy: TableConfig['privacy'];
        target: number;
        cube: boolean;
        blinds: TableConfig['blinds'];
        chat: boolean;
        voice: TableConfig['voice'];
        teams: boolean;
        invitees: string[];
    }

    const asInput = (game: GameId, config: TableConfig, privacy: TableConfig['privacy'], invitees: readonly string[]): TableInput =>
    {
        /**
         * The room is SPREAD rather than assigned afterwards, so it is absent from the object when
         * there is none. The server reads "is there a room" and a key that is present holding
         * undefined is one an over-eager serialiser turns into null - which is the same request
         * with a different meaning, because that field decides the privacy.
         */
        return {
            game,
            seats: config.seats,
            mode: config.mode,
            privacy,
            target: config.target,
            cube: config.cube,
            blinds: config.blinds,
            chat: config.chat,
            voice: config.voice,
            teams: teamsOf(catalogue.rules(game).partners, config.seats, config.teams),
            invitees: [...invitees],
            ...(config.roomId === undefined ? {} : { roomId: config.roomId })
        };
    };

    const settle = async (tableId: string) =>
    {
        const table = await client.tables.ready({ params: { id: tableId }, input: { ready: true } });

        if (table.chairs.every((chair) => chair.who !== undefined && chair.ready))
        {
            await client.tables.start({ params: { id: tableId } }).catch(() => undefined);
        }
    };

    return {
        table: () => viewing.data() ?? null,
        loading: () => viewing.loading(),
        failed: () => viewing.error(),

        seated: () => seated.data()?.tables ?? [],

        waiting: () => (seated.data()?.tables ?? []).filter((table) => table.yourTurn === true),

        open(tableId)
        {
            left.delete(tableId);
            setOpenId(tableId);
            arriving.get(tableId)?.();
        },
        close: () => setOpenId(''),
        openId,

        me: () => account.user()?.id ?? '',

        async host(game, config, invitees)
        {
            const made = await client.tables.create({ input: asInput(game, config, config.privacy, invitees) });
            await revalidate();
            return made.id;
        },

        quick(game, ask = {})
        {
            const out = searches.get(game);

            if (out !== undefined)
            {
                return out;
            }

            const search = client.tables.quick({ input: { game, ...ask, voice: catalogue.defaults(game).voice } })
                .then(async (table) =>
                {
                    await revalidate();

                    const late = runtime().clock.after(ARRIVAL_MS, () => arriving.get(table.id)?.());

                    arriving.set(table.id, () =>
                    {
                        late();
                        arriving.delete(table.id);
                        done(game);
                    });

                    return table.id;
                })
                .catch((error: unknown) =>
                {
                    done(game);
                    throw error;
                });

            searches.set(game, search);
            setFinding((current) => [...current, game]);

            return search;
        },

        finding,

        async claim(tableId)
        {
            const claimed = await client.tables.claim({ params: { id: tableId } });
            await revalidate();
            return claimed.seat ?? null;
        },

        async leave(tableId, forfeit)
        {
            await client.tables.leave({ params: { id: tableId }, input: { forfeit } });
            if (untrack(openId) === tableId)
            {
                setOpenId('');
            }
            await revalidate();
        },

        async ready(tableId, ready)
        {
            await client.tables.ready({ params: { id: tableId }, input: { ready } });
            await revalidate();
        },

        async invite(tableId, handle)
        {
            await client.tables.invite({ params: { id: tableId }, input: { id: handle } });
            await revalidate();
        },

        async end(tableId)
        {
            await client.tables.close({ params: { id: tableId } });
            if (untrack(openId) === tableId)
            {
                setOpenId('');
            }
            await revalidate();
        },

        async setVoice(tableId, voice)
        {
            await client.tables.voice({ params: { id: tableId }, input: { voice } });
            await revalidate();
        },

        async begin(tableId)
        {
            await client.tables.start({ params: { id: tableId } });
            await revalidate();
        },

        async again(tableId)
        {
            await settle(tableId);
            await revalidate();
        },

        refresh: revalidate,

        start()
        {
            const live = useRealtime();

            const offNudge = live.onNudge((scope) =>
            {
                if (scope === 'table')
                {
                    void revalidate().catch(() => undefined);
                }

                if (scope === 'game')
                {
                    void seated.refetch();
                }
            });

            const offGame = live.onGame((frame) =>
            {
                const known = untrack(seated.data)?.tables.find((table) => table.matchId === frame.match.id);
                const mine = frame.match.finishedAt === undefined && frame.match.mine !== undefined && frame.match.mine === frame.match.turn;

                if (known === undefined || frame.match.finishedAt !== undefined || (known.yourTurn === true) !== mine)
                {
                    void seated.refetch();
                }
            });

            return () =>
            {
                offNudge();
                offGame();
            };
        },

        stop: () => undefined,

        reset()
        {
            left.clear();
            asked += 1;
            rehold([]);
            setOpenId('');
            inFlight = Promise.resolve();

            for (const arrived of [...arriving.values()])
            {
                arrived();
            }

            searches.clear();
            setFinding([]);
            void seated.refetch();
        }
    };
});
