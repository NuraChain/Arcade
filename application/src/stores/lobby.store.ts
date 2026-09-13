import { createStore, createResource, createSignal, untrack, type Getter } from 'azerothjs';

import { ApiError, client, type TableSummary } from '../api.ts';
import type { GameId } from '../data/games.ts';
import type { TableConfig } from '../data/tables.ts';
import { useAccount } from './account.store.ts';
import { useCatalogue } from './catalogue.store.ts';
import { useRealtime } from './realtime.store.ts';

export interface LobbyApi
{
    /** The table this page is showing, or null. */
    table: Getter<TableSummary | null>;
    loading: Getter<boolean>;
    failed: Getter<unknown>;

    /** Where this account is sitting right now. Survives a reload and a second device. */
    seated: Getter<TableSummary[]>;

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
    quick(game: GameId, config?: TableConfig): Promise<string>;

    /** Takes a chair. Null means the table filled up first - an answer, not a failure. */
    claim(tableId: string): Promise<number | null>;

    leave(tableId: string): Promise<void>;
    ready(tableId: string, ready: boolean): Promise<void>;
    invite(tableId: string, handle: string): Promise<void>;
    end(tableId: string): Promise<void>;

    refresh(): Promise<void>;
    start(): () => void;
    stop(): void;
    reset(): void;
}

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

    const who = (): string | null => account.user()?.id ?? null;

    const [openId, setOpenId] = createSignal('');

    const seated = createResource(who, () => client.tables.mine(), { name: 'tables.mine' });

    const viewing = createResource(
        () => (openId() === '' ? null : { id: openId(), who: who() }),
        async (current) =>
        {
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

    const revalidate = (): Promise<void> =>
    {
        inFlight = inFlight.catch(() => undefined).then(async () =>
        {
            await Promise.all([
                seated.refetch(),
                untrack(openId) === '' ? Promise.resolve() : viewing.refetch()
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
        invitees: string[];
    }

    const asInput = (game: GameId, config: TableConfig, privacy: TableConfig['privacy'], invitees: readonly string[]): TableInput => ({
        game,
        seats: config.seats,
        mode: config.mode,
        privacy,
        target: config.target,
        cube: config.cube,
        blinds: config.blinds,
        invitees: [...invitees]
    });

    return {
        table: () => viewing.data() ?? null,
        loading: () => viewing.loading(),
        failed: () => viewing.error(),

        seated: () => seated.data()?.tables ?? [],

        open: (tableId) => setOpenId(tableId),
        close: () => setOpenId(''),
        openId,

        me: () => account.user()?.id ?? '',

        async host(game, config, invitees)
        {
            const made = await client.tables.create({ input: asInput(game, config, config.privacy, invitees) });
            await revalidate();
            return made.id;
        },

        /**
         * The whole of matchmaking, and it is a query.
         *
         * Look for an open public table for this game with a chair going, and take one. If
         * somebody takes the last chair between the read and the claim, try the next table; if
         * there is nothing left, open one and wait in it. Nobody is invented to fill it.
         */
        async quick(game, config)
        {
            const { tables } = await client.tables.open({ query: { game } });

            for (const candidate of tables)
            {
                const claimed = await client.tables.claim({ params: { id: candidate.id } });
                if (claimed.seat !== undefined)
                {
                    await revalidate();
                    return candidate.id;
                }
            }

            /*
              * The table this opens has to be one the GAME plays. The fallback here was a literal
              * four seats and no target, so quick-matching backgammon - which plays two - asked for
              * a four-seat table, and nothing refused it until the server started checking. Asking
              * the catalogue answers from the server's own rules, which is where seat counts live.
              */
            const made = await client.tables.create({
                input: asInput(game, config ?? catalogue.defaults(game), 'public', [])
            });
            await revalidate();
            return made.id;
        },

        async claim(tableId)
        {
            const claimed = await client.tables.claim({ params: { id: tableId } });
            await revalidate();
            return claimed.seat ?? null;
        },

        async leave(tableId)
        {
            await client.tables.leave({ params: { id: tableId } });
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

        refresh: revalidate,

        /** A chair changing hands is a social change: it moves who is sitting where. */
        start()
        {
            return useRealtime().onNudge((scope) =>
            {
                if (scope === 'social')
                {
                    void revalidate().catch(() => undefined);
                }
            });
        },

        stop: () => undefined,

        reset()
        {
            setOpenId('');
            inFlight = Promise.resolve();
            void seated.refetch();
        }
    };
});
