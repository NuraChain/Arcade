/**
 * The only contract between the product and the board renderer.
 *
 * Shaped like `world/bridge.ts` and for the same reason: everything under `game/` imports nothing
 * from AzerothJS, so the board maths can be tested with no browser and the renderer stays out of every bundle
 * that does not ask for it. The renderer is told what the board looks like and emits which token was
 * pointed at; it never decides whether a move is legal, who was captured or who won. Those answers
 * come from the server and arrive here already made.
 *
 * What the renderer DOES decide is how the change is shown: which squares a token walks over on the
 * way, whether a token that went back to its yard was captured or simply started there, how long the
 * die tumbles. None of that touches the state - it is the difference between watching a game and
 * reading one.
 */

export interface BoardToken
{
    /** Stable across a move, so the renderer can walk the same sprite rather than redraw one. */
    key: string;

    colour: string;

    /** Progress along this colour's own path: -1 in the yard, 56 home. Drives the walk. */
    at: number;

    col: number;
    row: number;

    /** Whether this token can be moved right now, for the affordance the canvas draws. */
    playable: boolean;
}

export interface BoardView
{
    tokens: readonly BoardToken[];

    /** The roll waiting to be used, or null when nobody has rolled. */
    die: number | null;

    /** The colour whose turn it is, so the board can show it without reading any rule. */
    turn: string | null;

    /**
     * Whether the turn is the reader's. The playable tokens cannot say it: before anybody rolls
     * there are none, which is exactly the moment worth announcing.
     */
    yours: boolean;

    /** Set once, when somebody has won. */
    winner: string | null;

    lit?: boolean;

    beats?: readonly LudoBeat[];
}

export interface LudoBeat
{
    rev: number;
    e: string;
    colour: string | null;
    die?: number;
    why?: string;
}

export interface BoardOptions
{
    host: HTMLElement;

    /** The rendered board image. One texture, fetched once when a match starts. */
    plate: string;

    view: BoardView;

    reducedMotion: boolean;

    sound: boolean;

    /** Told which token was pointed at. The DOM list is the real control; this is the shortcut. */
    onPick?: (key: string) => void;

    /**
     * Told when the scene is up. There is deliberately no `onFailed` beside it: the world has one
     * because `createWorld` resolves either way and has to say which, and this factory REJECTS -
     * so a second way of saying the same thing would be a callback nothing calls, which is the
     * same dead weight as a message key with no producer.
     */
    onReady?: () => void;
}

export interface BoardHandle
{
    /** The authoritative board, as it now stands. Whatever moved is walked to its square. */
    show(view: BoardView): void;

    setReducedMotion(on: boolean): void;

    setSound(on: boolean): void;

    resize(): void;

    pause(): void;

    resume(): void;

    dispose(): void;
}

export type BoardFactory = (options: BoardOptions) => Promise<BoardHandle>;
