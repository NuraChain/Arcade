import { createStore, createResource, createSignal, untrack, type Getter } from 'azerothjs';

import { ApiError, client, type MatchPlay, type MatchView } from '../api.ts';

export type MatchEvent = Awaited<ReturnType<typeof client.matches.since>>['events'][number];

export interface EventBatch
{
    seq: number;
    events: readonly MatchEvent[];
}
import { ludoOf } from '../data/match.ts';
import { useAccount } from './account.store.ts';
import { runtime } from '../lib/runtime.ts';
import { useLocale } from './locale.store.ts';
import { useRealtime, type ReplyFrame } from './realtime.store.ts';
import { useToasts } from './toasts.store.ts';

/**
 * The board, as the server says it stands.
 *
 * Nothing here decides anything about the game. The legal moves arrive from the server for this
 * viewer, the die arrives drawn, and the two verbs this store has - roll and move - name a token at
 * most. They are LUDO's verbs, composed into the one `play` route every game shares: a second game
 * adds its own here without the route, the idempotency key or the revision check being written
 * twice. That is what keeps a second copy of the rules out of the browser: the client renders what it
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

export type Outcome = 'now' | 'already' | 'stale' | 'failed';

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
    events: Getter<EventBatch>;

    canRoll: Getter<boolean>;

    /** The tokens this viewer may move right now. Empty unless it is their turn and they rolled. */
    moves: Getter<number[]>;

    /** The action in flight, so a control can disable itself without inventing a state. */
    busy: Getter<boolean>;

    roll(): Promise<Outcome>;
    move(piece: number): Promise<Outcome>;

    /**
     * Any game's verb, composed by whoever knows the game.
     *
     * `roll` and `move` above are ludo's, spelled here because ludo's board is the one that calls
     * them; a second game's board composes its own play and hands it over rather than growing two
     * more methods on a store every game shares.
     */
    play(what: MatchPlay): Promise<Outcome>;

    resign(): Promise<Outcome>;

    refresh(): Promise<void>;
    start(): () => void;
    stop(): void;
    reset(): void;
}

let keys = 0;

const mintKey = (): string =>
{
    keys += 1;

    return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${ runtime().clock.now().toString(36) }-${ keys.toString(36) }`;
};

export const ACK_MS = 3000;

export const POLL_MS = 3000;

interface Answer
{
    match: MatchView;
    applied: 'now' | 'already' | 'stale';
    events: readonly MatchEvent[];
}

export const useBoard = createStore((): BoardApi =>
{
    const account = useAccount();

    const who = (): string | null => account.user()?.id ?? null;

    const [openId, setOpenId] = createSignal('');
    const [busy, setBusy] = createSignal(false);
    const [latest, setLatest] = createSignal<MatchView | null>(null);
    const [events, setEvents] = createSignal<EventBatch>({ seq: 0, events: [] });

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

    const board = (): MatchView | null =>
    {
        const fetched = viewing.data() ?? null;
        const held = latest();

        if (held === null || held.id !== openId())
        {
            return fetched;
        }

        return fetched !== null && fetched.id === held.id && fetched.rev >= held.rev ? fetched : held;
    };

    let heardFor = '';
    let heardRev = -1;

    const waiting = new Map<string, (reply: ReplyFrame) => void>();

    const heard = (match: MatchView, batch: readonly MatchEvent[]): void =>
    {
        const held = untrack(board);
        const base = held !== null && held.id === match.id ? held.rev : -1;

        if (heardFor !== match.id)
        {
            heardFor = match.id;
            heardRev = -1;
        }

        const floor = Math.max(base, heardRev);
        const fresh = batch.filter((event) => event.rev > floor);

        setLatest((current) => current !== null && current.id === match.id && current.rev >= match.rev ? current : match);

        if (fresh.length === 0 || (floor >= 0 && fresh[0].rev > floor + 1))
        {
            return;
        }

        heardRev = fresh[fresh.length - 1].rev;
        setEvents((current) => ({ seq: current.seq + 1, events: fresh }));
    };

    const overSocket = (id: string, key: string, rev: number, play: MatchPlay): Promise<Answer | null> =>
        new Promise((resolve, reject) =>
        {
            if (!useRealtime().play(id, key, rev, play))
            {
                resolve(null);
                return;
            }

            const late = runtime().clock.after(ACK_MS, () =>
            {
                waiting.delete(key);
                resolve(null);
            });

            waiting.set(key, (reply) =>
            {
                late();
                waiting.delete(key);

                if (reply.t === 'ack')
                {
                    resolve(reply);
                    return;
                }

                reject(new ApiError(reply.status, 'refused', reply.message, undefined));
            });
        });

    const catchUp = async (): Promise<void> =>
    {
        const current = untrack(board);

        if (current === null)
        {
            await revalidate();
            return;
        }

        try
        {
            const delta = await client.matches.since({ params: { id: current.id }, query: { rev: String(current.rev) } });

            heard(delta.match, delta.events);
        }
        catch
        {
            await revalidate();
        }
    };

    const act = async (play: MatchPlay | null): Promise<Outcome> =>
    {
        const current = untrack(board);

        if (current === null || untrack(busy))
        {
            return 'failed';
        }

        setBusy(true);

        const key = mintKey();
        const id = current.id;

        try
        {
            const answer = (play === null ? null : await overSocket(id, key, current.rev, play))
                ?? (play === null
                    ? await client.matches.resign({ params: { id }, input: { key } })
                    : await client.matches.play({ params: { id }, input: { key, rev: current.rev, play } }));

            heard(answer.match, answer.events);

            return answer.applied;
        }
        catch
        {
            await revalidate().catch(() => undefined);

            useToasts().show({ kind: 'error', text: useLocale().t('match.actionFailed'), dedupe: 'match-action' });

            return 'failed';
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

        events,

        roll: async () => await act({ kind: 'ludo', verb: 'roll' }),

        move: async (piece) => await act({ kind: 'ludo', verb: 'move', piece }),

        play: async (what) => await act(what),

        resign: async () => await act(null),

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
            const live = useRealtime();

            const offNudge = live.onNudge((scope, id) =>
            {
                if (scope === 'game' && untrack(openId) !== '' && (id === undefined || id === untrack(openId)))
                {
                    void catchUp().catch(() => undefined);
                }
            });

            const offGame = live.onGame((frame) =>
            {
                if (frame.match.id === untrack(openId))
                {
                    heard(frame.match, frame.events);
                }
            });

            const offReply = live.onReply((frame) => waiting.get(frame.key)?.(frame));

            let cancel: (() => void) | null = null;

            const poll = (): void =>
            {
                cancel = runtime().clock.after(POLL_MS, () =>
                {
                    const cut = untrack(live.status);
                    const shown = typeof document === 'undefined' || (document.visibilityState === 'visible' && navigator.onLine !== false);

                    if (untrack(openId) !== '' && shown && (cut === 'down' || cut === 'connecting'))
                    {
                        void catchUp().catch(() => undefined);
                    }

                    poll();
                });
            };

            poll();

            return () =>
            {
                cancel?.();
                offNudge();
                offGame();
                offReply();
            };
        },

        stop: () => undefined,

        reset()
        {
            setOpenId('');
            setBusy(false);
            setLatest(null);
            setEvents({ seq: 0, events: [] });
            inFlight = Promise.resolve();
            heardFor = '';
            heardRev = -1;
            waiting.clear();
        }
    };
});
