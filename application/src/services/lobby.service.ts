import type { GameId } from '../data/games.ts';
import type { Person } from '../data/mock/types.ts';
import { TABLE_RULES } from '../data/tables.ts';
import { TIMING, type MatchIntent, type MatchResult, type MatchState, type Seat } from '../lib/matchmaking.ts';
import type { Random } from '../lib/random.ts';

export interface Arrival
{
    after: number;
    playerId: string;
}

export interface InviteReply
{
    after: number;
    accepted: boolean;
}

export interface RollEntry
{
    turn: number;
    playerId: string;
    dice: [number, number];
}

export interface Finish
{
    after: number;
    result: MatchResult;
    rolls: RollEntry[];
    verification: string;
}

export function rankPool(pool: readonly Person[], game: GameId, random: Random): Person[]
{
    const favourites = random.shuffle(pool.filter((person) => person.favourite === game));
    const others = random.shuffle(pool.filter((person) => person.favourite !== game));
    return [...favourites, ...others];
}

export function planCandidates(intent: MatchIntent, pool: readonly Person[], random: Random): Arrival[]
{
    const needed = Math.max(0, intent.seats - 1 - intent.invitees.length);
    const ranked = rankPool(pool, intent.game, random);
    const eta = TIMING.eta[intent.game];
    const arrivals: Arrival[] = [];
    for (let index = 0; index < Math.min(needed, ranked.length); index += 1)
    {
        arrivals.push({
            after: Math.round(eta * (0.4 + random.next() * 0.8) * (0.7 + index * 0.25)),
            playerId: ranked[index].id
        });
    }
    return arrivals.sort((a, b) => a.after - b.after);
}

export function planReadiness(seats: readonly Seat[], me: string, random: Random): Arrival[]
{
    return seats
        .filter((seat) => seat.playerId !== null && seat.playerId !== me && !seat.bot && !seat.ready)
        .map((seat) => ({ after: random.int(1200, 4500), playerId: seat.playerId as string }))
        .sort((a, b) => a.after - b.after);
}

export function planInviteReply(random: Random): InviteReply
{
    return { after: random.int(2000, 6000), accepted: random.chance(0.75) };
}

export function planChatter(players: readonly string[], me: string, random: Random, count = 3, lead: readonly [number, number] = [2500, 7000]): Array<{ after: number; playerId: string; line: number }>
{
    const others = players.filter((player) => player !== me && !player.startsWith('bot-'));
    if (others.length === 0)
    {
        return [];
    }
    const out: Array<{ after: number; playerId: string; line: number }> = [];
    let at = 0;
    let last = -1;
    for (let index = 0; index < count; index += 1)
    {
        at += index === 0 ? random.int(lead[0], lead[1]) : random.int(2500, 7000);
        let line = random.int(0, 3);
        if (line === last)
        {
            line = (line + 1 + random.int(0, 2)) % 4;
        }
        last = line;
        out.push({ after: at, playerId: random.pick(others), line });
    }
    return out;
}

function scoresFor(game: GameId, players: readonly string[], winner: string, random: Random): Record<string, number>
{
    const scores: Record<string, number> = {};
    for (const player of players)
    {
        if (game === 'hokm')
        {
            scores[player] = player === winner ? 7 : random.int(2, 6);
        }
        else if (game === 'poker')
        {
            scores[player] = player === winner ? random.int(1800, 3200) : random.int(200, 1400);
        }
        else if (game === 'backgammon')
        {
            scores[player] = player === winner ? random.int(3, 5) : random.int(0, 2);
        }
        else
        {
            scores[player] = player === winner ? 4 : random.int(0, 3);
        }
    }
    return scores;
}

export function planFinish(state: MatchState, random: Random): Finish
{
    const players = state.players;
    const winner = random.chance(0.5) ? state.me : random.pick(players.filter((player) => player !== state.me).concat(state.me));
    const game = state.intent?.game ?? 'backgammon';
    const dice = TABLE_RULES[game].fairness === 'dice';
    const rolls: RollEntry[] = [];
    if (dice)
    {
        const turns = random.int(14, 26);
        for (let turn = 1; turn <= turns; turn += 1)
        {
            rolls.push({ turn, playerId: players[(turn - 1) % players.length], dice: [random.int(1, 6), random.int(1, 6)] });
        }
    }
    const durationMs = random.int(18000, 32000);
    return {
        after: durationMs,
        result: { winners: [winner], scores: scoresFor(game, players, winner, random), durationMs },
        rolls,
        verification: random.int(0x100000, 0xFFFFFF).toString(16).toUpperCase() + '-' + random.int(0x1000, 0xFFFF).toString(16).toUpperCase()
    };
}

export function skillBand(person: Person | null): 'new' | 'casual' | 'regular' | 'sharp' | 'expert'
{
    return person?.skill ?? 'regular';
}
