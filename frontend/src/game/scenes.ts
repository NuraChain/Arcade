import type { BoardHandle, BoardOptions } from './bridge.ts';

/**
 * Which renderer draws which game, and the only place that decides it.
 *
 * `board-canvas` named one module, one export and one image file - so a second game's board meant
 * editing the component every board goes through, and `tools/budgets.mjs` asserted the lazy chunk
 * by the literal filename `ludo-board-`, which would have gone on passing while a second scene rode
 * into a route chunk unmeasured. A registry makes "every scene is lazy" a rule over a list rather
 * than a sentence about one file.
 *
 * **The loader is a function returning a dynamic import, and that is the whole point.** A static
 * import here would put the renderer into the component's chunk, and from there
 * into every route that renders a board. The import happens inside `mount`, once somebody is
 * actually looking at a game.
 *
 * The PLATE belongs to the scene rather than to the caller. It is the picture of the object that
 * game is played on, which is a fact about the game and not a prop a component should be trusted to
 * pass correctly.
 */

export interface Scene
{
    /** The rendered board image, fetched once when a match starts. */
    plate: string;

    open(options: Omit<BoardOptions, 'plate'>): Promise<BoardHandle>;
}

/**
 * The games this browser can DRAW, which is not the same list as the games the server can run.
 *
 * A game the server plays and this build has no scene for is a real state - an old client meeting a
 * newer server - and `sceneFor` answers null so the board says it cannot draw it rather than
 * throwing. That is the same rule `lib/lines.ts` follows for a line key it has never heard of.
 */
const SCENES: Record<string, () => Promise<Scene>> = {
    ludo: async (): Promise<Scene> =>
    {
        const { createLudoBoard } = await import('./board/ludo-board.ts');

        return {
            plate: '/board/ludo-board.svg',
            open: (options) => createLudoBoard({ ...options, plate: '/board/ludo-board.svg' })
        };
    }
};

/** Every game with a scene, for the build gate that checks each one landed in its own lazy chunk. */
export const SCENE_GAMES: readonly string[] = Object.keys(SCENES);

export function sceneFor(game: string): (() => Promise<Scene>) | null
{
    return SCENES[game] ?? null;
}
