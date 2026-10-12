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
    opens?: () => boolean;
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

export interface Run<E>
{
    fresh: E[];
    gap: boolean;
    whole: boolean;
}

export function runOf<E extends { rev: number }>(events: readonly E[], floor: number, upTo: number): Run<E>
{
    const fresh = events.filter((event) => event.rev > floor && event.rev <= upTo);

    return {
        fresh,
        gap: fresh.length > 0 && floor >= 0 && fresh[0].rev > floor + 1,
        whole: fresh.length === upTo - floor && fresh.every((event, index) => event.rev === floor + 1 + index)
    };
}

export function actsOf<M>(events: readonly Logged[], kind: string, after: number, upTo: number): Told<M>
{
    const acts = events
        .filter((event) => event.rev > after && event.rev <= upTo && event.log.kind === kind)
        .map((event): Act<M> => ({ rev: event.rev, seat: event.seat, moves: event.log.moves as readonly M[] }));

    return { acts, whole: acts.every((act, index) => act.rev === after + 1 + index) };
}
