import { batch, createStore, createSignal, type Getter } from 'azerothjs';

import type { GameId } from '../data/games.ts';
import { dataset, personById } from '../data/mock/index.ts';
import { REPLIES } from '../data/mock/scripts.ts';
import type { Person } from '../data/mock/types.ts';
import { defaultTable, type TableConfig } from '../data/tables.ts';
import type { LocalizedText } from '../lib/text.ts';
import {
    initial,
    nextDeadline,
    reduce,
    tableIdFor,
    type MatchEvent,
    type MatchIntent,
    type MatchState,
    type Phase,
    type Seat
} from '../lib/matchmaking.ts';
import { createRandom, hashSeed } from '../lib/random.ts';
import { runtime } from '../lib/runtime.ts';
import { planCandidates, planChatter, planFinish, planInviteReply, planReadiness, type RollEntry } from '../services/lobby.service.ts';
import { usePresence } from './presence.store.ts';
import { useAccount } from './account.store.ts';

export interface TableMessage
{
    id: string;
    from: string;
    text: LocalizedText | string;
    at: number;
}

export interface LastResult
{
    game: GameId;
    config: TableConfig;
    players: string[];
    winners: string[];
    at: number;
}

export type NoticeKind = 'joined' | 'left' | 'declined' | 'ready' | 'found' | 'invited';

export interface LobbyNotice
{
    seq: number;
    kind: NoticeKind;
    playerId: string | null;
}

export interface LobbyApi
{
    state: Getter<MatchState>;
    phase: Getter<Phase>;
    tableId: Getter<string | null>;
    seats: Getter<Seat[]>;
    me: Getter<string>;
    rolls: Getter<RollEntry[]>;
    verification: Getter<string | null>;
    chatter: Getter<TableMessage[]>;
    active: Getter<boolean>;
    lastResult: Getter<LastResult | null>;
    notice: Getter<LobbyNotice | null>;
    notify: Getter<boolean>;
    notifyWhenFull(): void;
    quick(game: GameId, config?: TableConfig): string;
    host(game: GameId, config: TableConfig, invitees: string[]): string;
    joinInvite(game: GameId, hostId: string): string;
    dispatch(event: MatchEvent): void;
    ready(ready: boolean): void;
    cancel(): void;
    leave(): void;
    rematch(): string;
    newOpponent(): string;
    fillWithBots(): void;
    keepWaiting(): void;
    invite(personId: string): void;
    say(text: string): void;
    finishNow(): void;
    reset(): void;
}

export const useLobby = createStore((): LobbyApi =>
{
    const account = useAccount();
    const presence = usePresence();

    const meId = (): string => account.user()?.id ?? 'you';

    const [state, setState] = createSignal<MatchState>(initial(meId()));
    const [rolls, setRolls] = createSignal<RollEntry[]>([]);
    const [verification, setVerification] = createSignal<string | null>(null);
    const [chatter, setChatter] = createSignal<TableMessage[]>([]);
    const [lastResult, setLastResult] = createSignal<LastResult | null>(null);
    const [notice, setNotice] = createSignal<LobbyNotice | null>(null);
    const [notify, setNotify] = createSignal(false);
    let noticeCounter = 0;

    const announce = (kind: NoticeKind, playerId: string | null): void =>
    {
        noticeCounter += 1;
        setNotice({ seq: noticeCounter, kind, playerId });
    };

    const timers = new Set<() => void>();
    let deadline: (() => void) | null = null;
    let messageCounter = 0;

    const now = (): number => runtime().clock.now();

    const later = (ms: number, fn: () => void): void =>
    {
        const cancel = runtime().clock.after(ms, () =>
        {
            timers.delete(cancel);
            fn();
        });
        timers.add(cancel);
    };

    const clearTimers = (): void =>
    {
        for (const cancel of timers)
        {
            cancel();
        }
        timers.clear();
        deadline?.();
        deadline = null;
    };

    const arm = (): void =>
    {
        deadline?.();
        deadline = null;
        const due = nextDeadline(state());
        if (due === null)
        {
            return;
        }
        deadline = runtime().clock.after(Math.max(0, due - now()), () =>
        {
            deadline = null;
            dispatch({ type: 'tick', at: now() });
        });
    };

    const randomFor = (scope: string): ReturnType<typeof createRandom> =>
        createRandom(hashSeed(runtime().seed, state().tableId ?? 'none', scope));

    const pool = (): Person[] =>
    {
        const me = meId();
        return dataset().people.filter((person) => person.id !== me && presence.isOnline(person.id) && !person.demo);
    };

    const scheduleReadiness = (): void =>
    {
        for (const arrival of planReadiness(state().seats, meId(), randomFor('ready')))
        {
            later(arrival.after, () => dispatch({ type: 'ready', playerId: arrival.playerId, ready: true, at: now() }));
        }
    };

    const scheduleChatter = (players: readonly string[], count: number, lead?: readonly [number, number]): void =>
    {
        const game = state().intent?.game;
        if (game === undefined)
        {
            return;
        }
        for (const entry of planChatter(players, meId(), randomFor('chatter:' + players.join(',')), count, lead))
        {
            later(entry.after, () =>
            {
                messageCounter += 1;
                setChatter([...chatter(), { id: 'tm-' + messageCounter, from: entry.playerId, text: REPLIES[game][entry.line % REPLIES[game].length], at: now() }]);
            });
        }
    };

    const scheduleFinish = (): void =>
    {
        const plan = planFinish(state(), randomFor('finish'));
        setRolls(plan.rolls);
        setVerification(plan.verification);
        later(plan.after, () => dispatch({ type: 'finish', result: plan.result, at: now() }));
    };

    const dispatch = (event: MatchEvent): void =>
    {
        const before = state();
        const after = reduce(before, event);
        if (after === before)
        {
            return;
        }
        batch(() =>
        {
            setState(after);
        });
        arm();
        if (after.phase !== 'idle')
        {
            for (const player of after.players)
            {
                if (!before.players.includes(player) && player !== meId() && !player.startsWith('bot-'))
                {
                    announce('joined', player);
                }
            }
            for (const player of before.players)
            {
                if (!after.players.includes(player) && player !== meId())
                {
                    announce('left', player);
                }
            }
        }
        if (event.type === 'invite-replied' && !event.accepted)
        {
            announce('declined', event.playerId);
        }
        if (event.type === 'ready' && event.ready && event.playerId !== meId())
        {
            announce('ready', event.playerId);
        }
        if (before.phase === 'searching' && after.phase === 'found')
        {
            announce('found', null);
        }
        if (event.type === 'finish' && after.intent !== null)
        {
            setLastResult({ game: after.intent.game, config: after.intent.config, players: after.players, winners: event.result.winners, at: event.at });
        }
        if (before.phase !== 'lobby' && after.phase === 'lobby')
        {
            scheduleReadiness();
            scheduleChatter(after.players, 2);
        }
        if (after.players.length > before.players.length && after.phase !== 'idle')
        {
            scheduleChatter(after.players.filter((player) => !before.players.includes(player)), 1, [900, 2200]);
        }
        if (before.phase !== 'playing' && after.phase === 'playing')
        {
            scheduleFinish();
        }
        if (after.phase === 'idle')
        {
            clearTimers();
            setChatter([]);
        }
    };

    const begin = (game: GameId, config: TableConfig, mode: 'quick' | 'private', invitees: string[]): string =>
    {
        clearTimers();
        setChatter([]);
        setRolls([]);
        setVerification(null);
        setNotify(false);
        const me = meId();
        setState(initial(me));
        const tableId = tableIdFor(runtime().seed, me, now());
        const intent: MatchIntent = { game, config, seats: config.seats, mode, invitees };
        if (mode === 'quick')
        {
            dispatch({ type: 'search', intent, tableId, at: now() });
            for (const arrival of planCandidates(intent, pool(), randomFor('candidates')))
            {
                later(arrival.after, () => dispatch({ type: 'candidate', playerId: arrival.playerId, at: now() }));
            }
        }
        else
        {
            dispatch({ type: 'host', intent, tableId, at: now() });
            for (const invitee of invitees)
            {
                const reply = planInviteReply(randomFor('invite:' + invitee));
                later(reply.after, () => dispatch({ type: 'invite-replied', playerId: invitee, accepted: reply.accepted, at: now() }));
            }
        }
        return tableId;
    };

    return {
        state,
        phase: () => state().phase,
        tableId: () => state().tableId,
        seats: () => state().seats,
        me: meId,
        rolls,
        verification,
        chatter,
        active: () => state().phase !== 'idle' && state().phase !== 'result',
        lastResult,
        notice,
        notify,
        notifyWhenFull: () => setNotify(true),

        quick: (game, config) => begin(game, config ?? defaultTable(game), 'quick', []),

        host: (game, config, invitees) => begin(game, config, 'private', invitees),

        joinInvite(game, hostId)
        {
            const config = defaultTable(game);
            const tableId = begin(game, config, 'private', []);
            dispatch({ type: 'join', playerId: hostId, at: now() });
            later(800, () => dispatch({ type: 'ready', playerId: hostId, ready: true, at: now() }));
            return tableId;
        },

        dispatch,

        ready: (ready) => dispatch({ type: 'ready', playerId: meId(), ready, at: now() }),

        cancel()
        {
            dispatch({ type: 'cancel', at: now() });
        },

        leave()
        {
            dispatch({ type: 'leave', playerId: meId(), at: now() });
        },

        rematch()
        {
            clearTimers();
            const tableId = tableIdFor(runtime().seed, meId(), now());
            setRolls([]);
            setVerification(null);
            dispatch({ type: 'rematch', tableId, at: now() });
            return tableId;
        },

        newOpponent()
        {
            const intent = state().intent;
            const game = intent?.game ?? 'backgammon';
            const config = intent?.config ?? defaultTable(game);
            return begin(game, config, 'quick', []);
        },

        fillWithBots()
        {
            dispatch({ type: 'fill-bots', at: now() });
        },

        keepWaiting()
        {
            dispatch({ type: 'keep-waiting', at: now() });
            for (const arrival of planCandidates(state().intent ?? { game: 'backgammon', config: defaultTable('backgammon'), seats: 2, mode: 'quick', invitees: [] }, pool(), randomFor('candidates:' + now())))
            {
                later(arrival.after, () => dispatch({ type: 'candidate', playerId: arrival.playerId, at: now() }));
            }
        },

        invite(personId)
        {
            dispatch({ type: 'invite', playerId: personId, at: now() });
            announce('invited', personId);
            const reply = planInviteReply(randomFor('invite:' + personId));
            later(reply.after, () => dispatch({ type: 'invite-replied', playerId: personId, accepted: reply.accepted, at: now() }));
        },

        say(text)
        {
            const clean = text.trim();
            if (clean === '')
            {
                return;
            }
            messageCounter += 1;
            setChatter([...chatter(), { id: 'tm-' + messageCounter, from: meId(), text: clean, at: now() }]);
        },

        finishNow()
        {
            if (state().phase !== 'playing')
            {
                return;
            }
            clearTimers();
            const plan = planFinish(state(), randomFor('finish'));
            setRolls(plan.rolls);
            setVerification(plan.verification);
            dispatch({ type: 'finish', result: plan.result, at: now() });
        },

        reset()
        {
            clearTimers();
            setState(initial(meId()));
            setRolls([]);
            setVerification(null);
            setChatter([]);
            setLastResult(null);
            setNotice(null);
            setNotify(false);
        }
    };
});

export function personFor(id: string): Person | undefined
{
    return personById(id);
}
