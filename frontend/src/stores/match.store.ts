import { batch, createStore, createResource, createSignal, untrack, type Getter } from 'azerothjs';

import { ApiError, client, type MatchPlay, type MatchView } from '../api.ts';

export type MatchEvent = Awaited<ReturnType<typeof client.matches.since>>['events'][number];

export interface EventBatch
{
    seq: number;
    id: string;
    events: readonly MatchEvent[];
    live: boolean;
    jump: boolean;
    opens?: () => boolean;
}

export const NO_EVENTS: EventBatch = { seq: 0, id: '', events: [], live: false, jump: false };

export const OPENING_MS = 10_000;
import { ludoOf } from '../data/match.ts';
import { runOf } from '../game/stage/feed.ts';
import { useAccount } from './account.store.ts';
import { refusalOf } from '../lib/refusal.ts';
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
    lost: Getter<boolean>;

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
     * more methods on a store every game shares. A play the board sends by itself (a flag claimed
     * when the other side's clock reaches nought) is `quiet`: a refusal of it is nobody's to read.
     */
    play(what: MatchPlay, quiet?: boolean): Promise<Outcome>;

    resign(): Promise<Outcome>;

    refresh(): Promise<void>;
    start(): () => void;
    stop(): void;
    reset(): void;
}

let keys = 0;

const mintKey = () =>
{
    keys += 1;

    return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${ runtime().clock.now().toString(36) }-${ keys.toString(36) }`;
};

export const ACK_MS = 1500;

export const POLL_MS = 3000;

export const MEND_MS = 3000;

interface Answer
{
    match: MatchView;
    applied: 'now' | 'already' | 'stale';
    events: readonly MatchEvent[];
}

export const useBoard = createStore((): BoardApi =>
{
    const account = useAccount();

    const who = () => account.user()?.id ?? null;

    const [openId, setOpenId] = createSignal('');
    const [busy, setBusy] = createSignal(false);
    const [latest, setLatest] = createSignal<MatchView | null>(null);
    const [events, setEvents] = createSignal<EventBatch>(NO_EVENTS);

    const [lost, setLost] = createSignal(false);

    const answered = (id: string, failed: boolean) =>
    {
        if (untrack(openId) === id)
        {
            setLost(failed);
        }
    };

    const viewing = createResource(
        () => (openId() === '' ? null : { id: openId(), who: who() }),
        async (current) =>
        {
            try
            {
                const match = await client.matches.view({ params: { id: current.id } });

                answered(current.id, false);

                return match;
            }
            catch (error)
            {
                const missing = error instanceof ApiError && error.status === 404;

                answered(current.id, !missing);

                if (missing)
                {
                    return null;
                }

                throw error;
            }
        },
        { name: 'matches.view' }
    );

    let inFlight: Promise<void> = Promise.resolve();

    const revalidate = () =>
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

        if (held === null || fetched === null)
        {
            return held !== null && held.id === openId() ? held : fetched;
        }

        if (fetched.id === held.id)
        {
            return fetched.rev >= held.rev ? fetched : held;
        }

        return held.id === openId() ? held : fetched;
    };

    let heardFor = '';
    let heardRev = -1;

    const early = new Map<string, { match: MatchView; events: readonly MatchEvent[]; at: number }>();
    const opened = new Set<string>();

    const opening = (id: string, at: number) => () =>
    {
        if (opened.has(id) || runtime().clock.now() - at > OPENING_MS)
        {
            return false;
        }

        opened.add(id);

        return true;
    };

    const starts = (match: MatchView, told: readonly MatchEvent[]) => match.rev === 1 && told.length === 1 && told[0].rev === 1;

    const keep = (match: MatchView, told: readonly MatchEvent[]) =>
    {
        const now = runtime().clock.now();

        for (const [id, held] of early)
        {
            if (now - held.at > OPENING_MS)
            {
                early.delete(id);
            }
        }

        early.set(match.id, { match, events: told, at: now });
    };

    const waiting = new Map<string, (reply: ReplyFrame) => void>();

    let unmended: MatchView | null = null;
    let mending = false;

    const floorOf = (id: string) =>
    {
        const held = untrack(board);

        return Math.max(held !== null && held.id === id ? held.rev : -1, heardFor === id ? heardRev : -1);
    };

    const newer = (match: MatchView) => (current: MatchView | null) =>
        (current !== null && current.id === match.id && current.rev >= match.rev ? current : match);

    const jumped = (match: MatchView) =>
    {
        if (match.id !== untrack(openId))
        {
            return;
        }

        const floor = floorOf(match.id);

        if (match.rev <= floor)
        {
            return;
        }

        heardFor = match.id;
        heardRev = match.rev;

        batch(() =>
        {
            setLatest(newer(match));
            setEvents((current) => ({ seq: current.seq + 1, id: match.id, events: [], live: false, jump: true }));
        });
    };

    const pending = () => unmended;

    const inTime = <T>(asked: Promise<T>) => new Promise<T | null>((resolve) =>
    {
        const stop = runtime().clock.after(MEND_MS, () => resolve(null));

        asked.then(
            (answer) =>
            {
                stop();
                resolve(answer);
            },
            () =>
            {
                stop();
                resolve(null);
            }
        );
    });

    const heard = (match: MatchView, told: readonly MatchEvent[], live: boolean, mended = false, at = runtime().clock.now()) =>
    {
        if (match.id !== untrack(openId))
        {
            return;
        }

        const floor = floorOf(match.id);
        const { fresh, gap } = runOf(told, floor, match.rev);
        const first = live && floor < 1 && heardFor !== match.id && starts(match, told);

        if (gap)
        {
            if (mended)
            {
                jumped(match);
            }
            else
            {
                mend(match);
            }

            return;
        }

        if (fresh.length > 0)
        {
            heardFor = match.id;
            heardRev = fresh[fresh.length - 1].rev;
        }

        batch(() =>
        {
            setLatest(newer(match));

            if (fresh.length > 0)
            {
                setEvents((current) => ({ seq: current.seq + 1, id: match.id, events: fresh, live, jump: false, ...(first ? { opens: opening(match.id, at) } : {}) }));
            }
        });
    };

    const mend = (seen: MatchView) =>
    {
        if (unmended === null || unmended.id !== seen.id || unmended.rev < seen.rev)
        {
            unmended = seen;
        }

        if (mending)
        {
            return;
        }

        mending = true;

        void (async () =>
        {
            while (unmended !== null)
            {
                const lost: MatchView = unmended;

                unmended = null;

                if (lost.id !== untrack(openId))
                {
                    continue;
                }

                const delta = await inTime(client.matches.since({ params: { id: lost.id }, query: { rev: String(Math.max(floorOf(lost.id), 0)) } }));

                if (delta !== null)
                {
                    heard(delta.match, delta.events, false, true);

                    continue;
                }

                const next = pending();
                const last = next !== null && next.id === lost.id && next.rev > lost.rev ? next : lost;

                if (last === next)
                {
                    unmended = null;
                }

                jumped(last);
            }

            mending = false;
        })();
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
                useRealtime().check();
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

                reject(new ApiError(reply.status, reply.code, reply.message, undefined));
            });
        });

    const catchUp = async () =>
    {
        const current = untrack(board);

        if (current === null || current.id !== untrack(openId))
        {
            await revalidate();
            return;
        }

        try
        {
            const delta = await client.matches.since({ params: { id: current.id }, query: { rev: String(current.rev) } });

            heard(delta.match, delta.events, false);
        }
        catch
        {
            await revalidate();
        }
    };

    const act = async (play: MatchPlay | null, quiet = false): Promise<Outcome> =>
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

            const told = play === null && answer.events.length === 0 && answer.match.rev > current.rev
                ? await inTime(client.matches.since({ params: { id }, query: { rev: String(current.rev) } }))
                : null;

            heard(told?.match ?? answer.match, told?.events ?? answer.events, true);

            return answer.applied;
        }
        catch (error)
        {
            await revalidate().catch(() => undefined);

            if (quiet)
            {
                return 'failed';
            }

            const word = refusalOf(error);

            useToasts().show({
                kind: word === null ? 'error' : 'warning',
                text: useLocale().t(word === null ? 'match.actionFailed' : `match.refused.${ word }`),
                dedupe: 'match-action'
            });

            return 'failed';
        }
        finally
        {
            setBusy(false);
        }
    };

    return {
        match: board,
        lost,

        openId,

        open(matchId)
        {
            setLost(false);
            setOpenId(matchId);

            const held = early.get(matchId);

            early.delete(matchId);

            if (held !== undefined && runtime().clock.now() - held.at <= OPENING_MS)
            {
                heard(held.match, held.events, true, false, held.at);
            }
        },

        close()
        {
            setLost(false);
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

        play: async (what, quiet) => await act(what, quiet),

        resign: async () => await act(null),

        refresh()
        {
            setLost(false);

            return revalidate();
        },

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
                    heard(frame.match, frame.events, true);

                    return;
                }

                if (starts(frame.match, frame.events))
                {
                    keep(frame.match, frame.events);
                }
            });

            const offReply = live.onReply((frame) => waiting.get(frame.key)?.(frame));

            let cancel: (() => void) | null = null;

            const poll = () =>
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
            setLost(false);
            setBusy(false);
            setLatest(null);
            setEvents(NO_EVENTS);
            inFlight = Promise.resolve();
            heardFor = '';
            heardRev = -1;
            unmended = null;
            waiting.clear();
            early.clear();
            opened.clear();
        }
    };
});
