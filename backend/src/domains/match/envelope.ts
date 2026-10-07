import type { MatchView } from '../../schemas.ts';
import type { Engine } from './engine.ts';
import type { MatchSeatRow } from './service.ts';
import type { Format } from './sides.ts';

type SeatRow = Pick<MatchSeatRow, 'seat' | 'who' | 'timeouts' | 'result' | 'rating_before' | 'rating_after'>;

export function envelopeOf(engine: Pick<Engine, 'standings' | 'sideOf'> | null, state: unknown, rows: readonly SeatRow[], finished: boolean, format: Format): MatchView['players']
{
    const places = finished && engine !== null ? engine.standings(state) : null;

    return rows.map((row) => ({
        seat: row.seat,
        who: row.who,
        ...(row.timeouts === null ? {} : { timeouts: row.timeouts }),
        ...(row.result == null ? {} : { result: row.result }),
        ...(row.rating_before == null || row.rating_after == null
            ? {}
            : { ratingBefore: row.rating_before, ratingAfter: row.rating_after }),
        ...(engine === null ? {} : { side: engine.sideOf(row.seat, format) }),
        ...(places === null ? {} : { place: places.find((one) => one.seat === row.seat)?.place ?? rows.length })
    }));
}
