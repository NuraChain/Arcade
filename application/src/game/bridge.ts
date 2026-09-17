/**
 * The only contract between the product and the board renderer.
 *
 * Shaped like `world/bridge.ts` and for the same reason: everything under `game/` imports nothing
 * from AzerothJS, so the board maths can be tested with no GPU and Phaser stays out of every bundle
 * that does not ask for it. The renderer is told what the board looks like and emits which token was
 * pointed at; it never decides whether a move is legal, who was captured or who won. Those answers
 * come from the server and arrive here already made.
 */

export interface BoardToken
{
    /** Stable across a move, so the renderer can tween the same sprite rather than redraw one. */
    key: string;

    colour: string;

    /** The colour's initial, drawn on the token so colour is never the only signal. */
    label: string;

    col: number;
    row: number;

    /** Whether this token can be moved right now, for the affordance the canvas draws. */
    playable: boolean;
}

export interface BoardOptions
{
    host: HTMLElement;

    /** The rendered board image. One texture, fetched once when a match starts. */
    plate: string;

    tokens: readonly BoardToken[];

    reducedMotion: boolean;

    /** Told which token was pointed at. The DOM list is the real control; this is the shortcut. */
    onPick?: (key: string) => void;

    onReady?: () => void;

    onFailed?: (reason: string) => void;
}

export interface BoardHandle
{
    /** The authoritative board, as it now stands. Tokens that moved are tweened to their square. */
    show(tokens: readonly BoardToken[]): void;

    setReducedMotion(on: boolean): void;

    resize(): void;

    pause(): void;

    resume(): void;

    dispose(): void;
}

export type BoardFactory = (options: BoardOptions) => Promise<BoardHandle>;
