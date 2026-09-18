import { createStore, createResource, createSignal, untrack, type Getter } from 'azerothjs';

import { ApiError, client, type MatchView } from '../api.ts';
import { ludoOf } from '../data/match.ts';
import { useAccount } from './account.store.ts';
import { runtime } from '../lib/runtime.ts';
import { useRealtime } from './realtime.store.ts';

/**
 * The board, as the server says it stands.
 *
 * Nothing here decides anything about the game. The legal moves arrive from the server for this
 * viewer, the die arrives drawn, and the two verbs this store has - roll and move - name a token at
 * most. That is what keeps a second copy of the rules out of the browser: the client renders what it
 * is told rather than working out what it is allowed to do, which is the same argument `policy.ts`
 * makes about who may write to whom.
 *
 * `act` is not optimistic. A move is sent, the server answers with the board as it now is, and that
 * answer is what renders - so a refusal cannot leave a token somewhere it never went. The cost is a
 * round trip per turn, which is the right trade on a turn-based game and the wrong one on a shooter.
 *
 * Every action carries a KEY, minted once per intention and held across retries. Without it a
 * repeated request is applied twice, because after a six the turn has not passed and a second roll
 * is perfectly legal. `applied` comes back `now`, `already` or `stale`, and none of them is an
 * error: a retried tap and a tap that crossed a realtime frame are both ordinary.
 */

export interface BoardApi
{
    match: Getter<MatchView | null>;
    loading: Getter<boolean>;
    failed: Getter<unknown>;

    open(matchId: string): void;
    close(): void;
    openId: Getter<string>;

    /** This viewer's seat, or null when they are only watching. */
    mine: Getter<number | null>;

    /**
     * True when it is this viewer's turn and they have not rolled yet.
     *
     * Ludo's own question, asked of the board the engine composed for this viewer. It stays on the
     * store because the store is what the roll button reads, and it reads a NARROWED board rather
     * than the envelope - a game with no die answers false here because it has no ludo board at
     * all, which is the right answer and not a special case anybody has to write.
     */
    canRoll: Getter<boolean>;

    /** The tokens this viewer may move right now. Empty unless it is their turn and they rolled. */
    moves: Getter<number[]>;

    /** The action in flight, so a control can disable itself without inventing a state. */
    busy: Getter<boolean>;

    roll(): Promise<void>;
    move(piece: number): Promise<void>;
    resign(): Promise<void>;

    refresh(): Promise<void>;
    start(): () => void;
    stop(): void;
    reset(): void;
}

let keys = 0;

const mintKey = (): string =>
{
    keys += 1;

    return `${ runtime().clock.now().toString(36) }-${ keys.toString(36) }`;
};

export const useBoard = createStore((): BoardApi =>
{
    const account = useAccount();

    const who = (): string | null => account.user()?.id ?? null;

    const [openId, setOpenId] = createSignal('');
    const [busy, setBusy] = createSignal(false);

    const viewing = createResource(
        () => (openId() === '' ? null : { id: openId(), who: who() }),
        async (current) =>
        {
            try
            {
                return await client.matches.view({ params: { id: current.id } });
            }
            catch (error)
            {
                if (error instanceof ApiError && error.status === 404)
                {
                    return null;
                }

                throw error;
            }
        },
        { name: 'matches.view' }
    );

    let inFlight: Promise<void> = Promise.resolve();

    const revalidate = (): Promise<void> =>
    {
        inFlight = inFlight.catch(() => undefined).then(async () =>
        {
            if (untrack(openId) !== '')
            {
                await viewing.refetch();
            }
        });

        return inFlight;
    };

    const board = (): MatchView | null => viewing.data() ?? null;

    const act = async (send: (id: string, key: string, rev: number) => Promise<{ match: MatchView }>): Promise<void> =>
    {
        const current = untrack(board);

        if (current === null || untrack(busy))
        {
            return;
        }

        setBusy(true);

        try
        {
            await send(current.id, mintKey(), current.rev);
            await revalidate();
        }
        catch
        {
            await revalidate().catch(() => undefined);
        }
        finally
        {
            setBusy(false);
        }
    };

    return {
        match: board,
        loading: () => viewing.loading(),
        failed: () => viewing.error(),

        openId,

        open(matchId)
        {
            setOpenId(matchId);
        },

        close()
        {
            setOpenId('');
        },

        mine: () => board()?.mine ?? null,

        canRoll: () =>
        {
            const current = board();

            if (current === null || current.finishedAt !== undefined)
            {
                return false;
            }

            const ludo = ludoOf(current);

            return ludo !== null
                && current.mine !== undefined
                && current.mine === current.turn
                && ludo.die === undefined;
        },

        moves: () =>
        {
            const current = board();

            return current === null ? [] : ludoOf(current)?.moves ?? [];
        },

        busy,

        roll: async () => await act(async (id, key, rev) =>
            await client.matches.roll({ params: { id }, input: { key, rev } })),

        move: async (piece) => await act(async (id, key, rev) =>
            await client.matches.move({ params: { id }, input: { key, rev, piece } })),

        resign: async () => await act(async (id, key) =>
            await client.matches.resign({ params: { id }, input: { key } })),

        refresh: revalidate,

        /**
         * The doorbell for this board.
         *
         * `game` is the one scope that names a match, and the frame carries nothing but its id - so
         * the answer is always to read the route again rather than to apply anything from the
         * frame. A nudge for a different match is somebody else's game and is ignored.
         */
        start()
        {
            return useRealtime().onNudge((scope, id) =>
            {
                if (scope === 'game' && (id === undefined || id === untrack(openId)))
                {
                    void revalidate().catch(() => undefined);
                }
            });
        },

        stop: () => undefined,

        reset()
        {
            setOpenId('');
            setBusy(false);
            inFlight = Promise.resolve();
        }
    };
});
