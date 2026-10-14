import { aroundTable } from './table-seats.ts';

export interface LobbySeat
{
    seat: number;
    x: number;
    y: number;
}

const CORNERS: readonly (readonly [number, number])[] = [[0, 0], [1, 0], [1, 1], [0, 1]];

const DEALT_LEFT: readonly string[] = ['poker'];

export function lobbySeats(game: string, seats: number, mine: number | undefined): LobbySeat[]
{
    if (game === 'ludo')
    {
        return Array.from({ length: seats }, (_, seat) =>
        {
            const [x, y] = CORNERS[(seats === 2 ? seat * 2 : seat) % CORNERS.length];

            return { seat, x, y };
        });
    }

    const turn = DEALT_LEFT.includes(game) ? 1 : -1;

    return aroundTable(seats, mine ?? null).map(({ seat, place }) =>
    {
        const angle = Math.PI / 2 + turn * (place / seats) * Math.PI * 2;

        return { seat, x: 0.5 + Math.cos(angle) / 2, y: 0.5 + Math.sin(angle) / 2 };
    });
}
