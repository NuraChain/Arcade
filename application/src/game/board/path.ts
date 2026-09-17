import { FINISHED, RING_STEPS, YARD, cellAt, type Cell, type LudoColour } from '../../../../server/src/domains/match/ludo/board.ts';

/**
 * The squares a token walks through on its way somewhere.
 *
 * The board's geometry is imported from the server's own `ludo/board.ts` rather than copied here.
 * That module imports nothing at all - `ludo-purity.spec.ts` reads it as text and fails if it ever
 * does - so it costs the bundle a few constants and nothing else, and it is the same precedent
 * `lib/attestation.ts` already follows for `deviceResource`. A second copy of a fifty-two square
 * ring would be a second description of one board, agreeing right up until somebody edited one.
 *
 * This is presentation only. The server decided where the token lands; all this works out is which
 * squares to draw it passing over on the way, so a capture is something a player watches happen
 * rather than a token blinking from one place to another.
 */

export type { Cell, LudoColour };

export { FINISHED, RING_STEPS, YARD };

/**
 * The squares between `from` and `to`, not counting where it started.
 *
 * A token leaving the yard has exactly one step - its entry square. A token reaching home has no
 * square for its final position, because home is not a square anybody stands on, so the walk ends
 * on the last home cell and the flourish is the renderer's business.
 */
export function pathBetween(colour: LudoColour, from: number, to: number): Cell[]
{
    if (from === YARD)
    {
        const entry = cellAt(colour, 0);

        return entry === null ? [] : [entry];
    }

    const last = Math.min(to, FINISHED - 1);
    const steps: Cell[] = [];

    for (let progress = from + 1; progress <= last; progress += 1)
    {
        const cell = cellAt(colour, progress);

        if (cell !== null)
        {
            steps.push(cell);
        }
    }

    return steps;
}
