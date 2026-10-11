export interface Logged
{
    rev: number;
    seat: number;
    log: { kind: string; moves: readonly unknown[] };
}

export interface Batch
{
    seq: number;
    id: string;
    events: readonly Logged[];
    live: boolean;
    jump: boolean;
}

export interface Act<M>
{
    rev: number;
    seat: number;
    moves: readonly M[];
}

export interface Told<M>
{
    acts: Act<M>[];
    whole: boolean;
}

export function actsOf<M>(events: readonly Logged[], kind: string, after: number, upTo: number): Told<M>
{
    const acts = events
        .filter((event) => event.rev > after && event.rev <= upTo && event.log.kind === kind)
        .map((event): Act<M> => ({ rev: event.rev, seat: event.seat, moves: event.log.moves as readonly M[] }));

    return { acts, whole: acts.every((act, index) => act.rev === after + 1 + index) };
}
