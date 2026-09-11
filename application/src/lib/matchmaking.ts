import type { GameId } from '../data/games.ts';
import type { TableConfig } from '../data/tables.ts';
import { hashSeed } from './random.ts';

export type Phase = 'idle' | 'searching' | 'found' | 'lobby' | 'starting' | 'playing' | 'result';

export type Mode = 'quick' | 'private' | 'rematch';

export interface Seat
{
    index: number;
    playerId: string | null;
    invitedId: string | null;
    ready: boolean;
    host: boolean;
    bot: boolean;
}

export interface MatchIntent
{
    game: GameId;
    config: TableConfig;
    seats: number;
    mode: Mode;
    invitees: string[];
}

export interface MatchResult
{
    winners: string[];
    scores: Record<string, number>;
    durationMs: number;
}

export interface MatchState
{
    phase: Phase;
    me: string;
    intent: MatchIntent | null;
    tableId: string | null;
    seats: Seat[];
    startedAt: number;
    eta: number;
    noMatch: boolean;
    countdown: number | null;
    result: MatchResult | null;
    players: string[];
}

export type MatchEvent =
    | { type: 'search'; intent: MatchIntent; tableId: string; at: number }
    | { type: 'host'; intent: MatchIntent; tableId: string; at: number }
    | { type: 'candidate'; playerId: string; bot?: boolean; at: number }
    | { type: 'accept'; at: number }
    | { type: 'join'; playerId: string; at: number }
    | { type: 'leave'; playerId: string; at: number }
    | { type: 'ready'; playerId: string; ready: boolean; at: number }
    | { type: 'invite'; playerId: string; at: number }
    | { type: 'invite-replied'; playerId: string; accepted: boolean; at: number }
    | { type: 'fill-bots'; at: number }
    | { type: 'keep-waiting'; at: number }
    | { type: 'tick'; at: number }
    | { type: 'finish'; result: MatchResult; at: number }
    | { type: 'rematch'; tableId: string; at: number }
    | { type: 'cancel'; at: number }
    | { type: 'reset' };

export const TIMING = {
    eta: { hokm: 9000, poker: 6000, backgammon: 4000, ludo: 7000 } satisfies Record<GameId, number>,
    noMatchAfter: 20000,
    foundHold: 3000,
    countdown: 3,
    readyWindow: 60000
} as const;

export function initial(me: string): MatchState
{
    return {
        phase: 'idle',
        me,
        intent: null,
        tableId: null,
        seats: [],
        startedAt: 0,
        eta: 0,
        noMatch: false,
        countdown: null,
        result: null,
        players: []
    };
}

function buildSeats(count: number, me: string, invitees: string[]): Seat[]
{
    const seats: Seat[] = [];
    for (let index = 0; index < count; index += 1)
    {
        seats.push({
            index,
            playerId: index === 0 ? me : null,
            invitedId: index === 0 ? null : (invitees[index - 1] ?? null),
            ready: false,
            host: index === 0,
            bot: false
        });
    }
    return seats;
}

export function openSeats(state: MatchState): Seat[]
{
    return state.seats.filter((seat) => seat.playerId === null);
}

export function seatOf(state: MatchState, playerId: string): Seat | undefined
{
    return state.seats.find((seat) => seat.playerId === playerId);
}

export function allReady(state: MatchState): boolean
{
    return state.seats.length > 0 && state.seats.every((seat) => seat.playerId !== null && seat.ready);
}

export function playersOf(seats: Seat[]): string[]
{
    return seats.flatMap((seat) => (seat.playerId === null ? [] : [seat.playerId]));
}

export function tableIdFor(seed: number, me: string, at: number): string
{
    return 't-' + hashSeed(seed, me, at).toString(36);
}

function occupy(seats: Seat[], playerId: string, bot: boolean): Seat[] | null
{
    if (seats.some((seat) => seat.playerId === playerId))
    {
        return null;
    }
    const invited = seats.findIndex((seat) => seat.playerId === null && seat.invitedId === playerId);
    const target = invited !== -1 ? invited : seats.findIndex((seat) => seat.playerId === null);
    if (target === -1)
    {
        return null;
    }
    return seats.map((seat, index) => (index === target
        ? { ...seat, playerId, invitedId: null, ready: bot, bot }
        : seat));
}

function vacate(seats: Seat[], playerId: string): Seat[]
{
    return seats.map((seat) => (seat.playerId === playerId
        ? { ...seat, playerId: null, ready: false, bot: false }
        : seat));
}

function fillBots(seats: Seat[]): Seat[]
{
    let counter = 0;
    return seats.map((seat) =>
    {
        if (seat.playerId !== null)
        {
            return seat;
        }
        counter += 1;
        return { ...seat, playerId: 'bot-' + counter, invitedId: null, ready: true, bot: true };
    });
}

function toStarting(state: MatchState, at: number): MatchState
{
    return { ...state, phase: 'starting', countdown: TIMING.countdown, startedAt: at, players: playersOf(state.seats) };
}

function toLobby(state: MatchState, at: number): MatchState
{
    return { ...state, phase: 'lobby', countdown: null, startedAt: at };
}

function settleLobby(state: MatchState, at: number): MatchState
{
    return allReady(state) ? toStarting(state, at) : state;
}

export function reduce(state: MatchState, event: MatchEvent): MatchState
{
    if (event.type === 'reset')
    {
        return initial(state.me);
    }

    if (event.type === 'cancel')
    {
        return state.phase === 'idle' || state.phase === 'playing' ? state : initial(state.me);
    }

    switch (state.phase)
    {
        case 'idle':
            if (event.type === 'search')
            {
                return {
                    ...initial(state.me),
                    phase: 'searching',
                    intent: event.intent,
                    tableId: event.tableId,
                    seats: buildSeats(event.intent.seats, state.me, []),
                    startedAt: event.at,
                    eta: TIMING.eta[event.intent.game],
                    players: [state.me]
                };
            }
            if (event.type === 'host')
            {
                return {
                    ...initial(state.me),
                    phase: 'lobby',
                    intent: event.intent,
                    tableId: event.tableId,
                    seats: buildSeats(event.intent.seats, state.me, event.intent.invitees),
                    startedAt: event.at,
                    players: [state.me]
                };
            }
            return state;

        case 'searching':
            if (event.type === 'candidate')
            {
                const seats = occupy(state.seats, event.playerId, event.bot === true);
                if (seats === null)
                {
                    return state;
                }
                const next = { ...state, seats, players: playersOf(seats) };
                return openSeats(next).length === 0 ? { ...next, phase: 'found', startedAt: event.at, noMatch: false } : next;
            }
            if (event.type === 'tick')
            {
                return !state.noMatch && event.at - state.startedAt >= TIMING.noMatchAfter ? { ...state, noMatch: true } : state;
            }
            if (event.type === 'keep-waiting')
            {
                return { ...state, noMatch: false, startedAt: event.at };
            }
            if (event.type === 'fill-bots')
            {
                const seats = fillBots(state.seats);
                return { ...state, phase: 'found', seats, players: playersOf(seats), startedAt: event.at, noMatch: false };
            }
            if (event.type === 'invite')
            {
                const open = state.seats.findIndex((seat) => seat.playerId === null && seat.invitedId === null);
                if (open === -1)
                {
                    return state;
                }
                return { ...state, seats: state.seats.map((seat, index) => (index === open ? { ...seat, invitedId: event.playerId } : seat)) };
            }
            if (event.type === 'invite-replied' && event.accepted)
            {
                const seats = occupy(state.seats, event.playerId, false);
                if (seats === null)
                {
                    return state;
                }
                const next = { ...state, seats, players: playersOf(seats) };
                return openSeats(next).length === 0 ? { ...next, phase: 'found', startedAt: event.at, noMatch: false } : next;
            }
            if (event.type === 'invite-replied')
            {
                return { ...state, seats: state.seats.map((seat) => (seat.invitedId === event.playerId ? { ...seat, invitedId: null } : seat)) };
            }
            return state;

        case 'found':
            if (event.type === 'accept')
            {
                return toLobby(state, event.at);
            }
            if (event.type === 'tick')
            {
                return event.at - state.startedAt >= TIMING.foundHold ? toLobby(state, event.at) : state;
            }
            if (event.type === 'leave' && event.playerId !== state.me)
            {
                const seats = vacate(state.seats, event.playerId);
                return { ...state, phase: 'searching', seats, players: playersOf(seats), startedAt: event.at, noMatch: false };
            }
            if (event.type === 'leave')
            {
                return initial(state.me);
            }
            return state;

        case 'lobby':
            if (event.type === 'join' || (event.type === 'invite-replied' && event.accepted))
            {
                const seats = occupy(state.seats, event.playerId, false);
                return seats === null ? state : settleLobby({ ...state, seats, players: playersOf(seats) }, event.at);
            }
            if (event.type === 'invite-replied')
            {
                return { ...state, seats: state.seats.map((seat) => (seat.invitedId === event.playerId ? { ...seat, invitedId: null } : seat)) };
            }
            if (event.type === 'invite')
            {
                const open = state.seats.findIndex((seat) => seat.playerId === null && seat.invitedId === null);
                if (open === -1)
                {
                    return state;
                }
                return { ...state, seats: state.seats.map((seat, index) => (index === open ? { ...seat, invitedId: event.playerId } : seat)) };
            }
            if (event.type === 'ready')
            {
                if (seatOf(state, event.playerId) === undefined)
                {
                    return state;
                }
                const seats = state.seats.map((seat) => (seat.playerId === event.playerId ? { ...seat, ready: event.ready } : seat));
                return settleLobby({ ...state, seats }, event.at);
            }
            if (event.type === 'fill-bots')
            {
                const seats = fillBots(state.seats);
                return settleLobby({ ...state, seats, players: playersOf(seats) }, event.at);
            }
            if (event.type === 'leave')
            {
                if (event.playerId === state.me)
                {
                    return initial(state.me);
                }
                const seats = vacate(state.seats, event.playerId);
                return { ...state, seats, players: playersOf(seats) };
            }
            return state;

        case 'starting':
            if (event.type === 'tick')
            {
                const elapsedSteps = Math.floor((event.at - state.startedAt) / 1000);
                const remaining = Math.max(0, TIMING.countdown - elapsedSteps);
                if (remaining === (state.countdown ?? 0))
                {
                    return state;
                }
                return remaining === 0
                    ? { ...state, phase: 'playing', countdown: null, startedAt: event.at }
                    : { ...state, countdown: remaining };
            }
            if (event.type === 'ready' && !event.ready)
            {
                const seats = state.seats.map((seat) => (seat.playerId === event.playerId ? { ...seat, ready: false } : seat));
                return toLobby({ ...state, seats }, event.at);
            }
            if (event.type === 'leave')
            {
                if (event.playerId === state.me)
                {
                    return initial(state.me);
                }
                const seats = vacate(state.seats, event.playerId);
                return toLobby({ ...state, seats, players: playersOf(seats) }, event.at);
            }
            return state;

        case 'playing':
            if (event.type === 'finish')
            {
                return { ...state, phase: 'result', result: event.result, startedAt: event.at };
            }
            if (event.type === 'leave' && event.playerId === state.me)
            {
                return initial(state.me);
            }
            return state;

        case 'result':
            if (event.type === 'rematch')
            {
                const seats = state.seats.map((seat) => ({ ...seat, ready: seat.bot, invitedId: null }));
                return {
                    ...state,
                    phase: 'lobby',
                    intent: state.intent === null ? null : { ...state.intent, mode: 'rematch' },
                    tableId: event.tableId,
                    seats,
                    startedAt: event.at,
                    countdown: null,
                    result: null,
                    noMatch: false
                };
            }
            return state;

        default:
            return state;
    }
}

export function nextDeadline(state: MatchState): number | null
{
    switch (state.phase)
    {
        case 'searching':
            return state.noMatch ? null : state.startedAt + TIMING.noMatchAfter;
        case 'found':
            return state.startedAt + TIMING.foundHold;
        case 'starting':
            return state.startedAt + (TIMING.countdown - (state.countdown ?? TIMING.countdown) + 1) * 1000;
        default:
            return null;
    }
}
