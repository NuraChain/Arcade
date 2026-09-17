import Phaser from 'phaser';

import { centreOf, tokenRadius } from '../layout.ts';
import type { BoardHandle, BoardOptions, BoardToken } from '../bridge.ts';

/**
 * The only file in this repository that imports Phaser.
 *
 * It is reached through one dynamic `import()` inside a component's `mount`, exactly as
 * `world-canvas.component.azeroth` reaches three.js, so the whole library lands in its own chunk and
 * neither the landing page's payload nor any route budget sees it. `tools/budgets.mjs` refuses a
 * build where it appears anywhere else.
 *
 * Every non-default in the config below is here because leaving it out costs something real:
 *
 *   audio        Phaser opens a WebAudio context otherwise and Chrome logs a warning about it. The
 *                640-cell matrix reads every warning, so that is a whole route failing on a sound
 *                nothing plays.
 *   keyboard     Phaser's keyboard plugin attaches a document listener and preventDefaults space and
 *                the arrows. The keyboard belongs entirely to the DOM controls beside this canvas -
 *                that is how the game is playable without a pointer.
 *   autoFocus    the default calls window.focus() on boot, which steals focus mid-navigation.
 *   banner       a console.log the matrix would read.
 *   Scale.NONE   RESIZE listens to the window, and this canvas changes size without one: the chat
 *                rail opening, the posture flipping at 768 and 1024, an overlay sheet. A
 *                ResizeObserver on the host is the only thing that sees all three.
 */

const RING = 0x000000;

const PALETTE: Record<string, number> = {
    red: 0xcc332e,
    green: 0x2e854d,
    yellow: 0xedbd2e,
    blue: 0x2e66b8
};

interface Held
{
    token: BoardToken;
    body: Phaser.GameObjects.Arc;
    gloss: Phaser.GameObjects.Arc;
    ring: Phaser.GameObjects.Arc;
    mark: Phaser.GameObjects.Text;
    halo: Phaser.GameObjects.Arc;
}

class TableScene extends Phaser.Scene
{
    #options!: BoardOptions;

    #plate?: Phaser.GameObjects.Image;

    #held = new Map<string, Held>();

    #size = 0;

    #motion = true;

    constructor()
    {
        super('table');
    }

    public init(options: BoardOptions): void
    {
        this.#options = options;
        this.#motion = !options.reducedMotion;
    }

    public preload(): void
    {
        this.load.image('plate', this.#options.plate);
    }

    public create(): void
    {
        this.#size = this.scale.width;

        this.#plate = this.add.image(0, 0, 'plate').setOrigin(0, 0);
        this.#plate.setDisplaySize(this.#size, this.#size);

        this.paint(this.#options.tokens);
        this.#options.onReady?.();
    }

    public reflow(size: number): void
    {
        this.#size = size;

        this.#plate?.setDisplaySize(size, size);

        for (const held of this.#held.values())
        {
            this.#place(held, false);
        }
    }

    public setMotion(on: boolean): void
    {
        this.#motion = on;
    }

    public paint(tokens: readonly BoardToken[]): void
    {
        const seen = new Set<string>();

        for (const token of tokens)
        {
            seen.add(token.key);

            const held = this.#held.get(token.key);

            if (held === undefined)
            {
                this.#held.set(token.key, this.#mint(token));
                continue;
            }

            const moved = held.token.col !== token.col || held.token.row !== token.row;
            held.token = token;

            this.#place(held, moved && this.#motion);
            held.halo.setVisible(token.playable);
        }

        for (const [key, held] of this.#held)
        {
            if (seen.has(key))
            {
                continue;
            }

            for (const part of [held.body, held.gloss, held.ring, held.mark, held.halo])
            {
                part.destroy();
            }

            this.#held.delete(key);
        }
    }

    #mint(token: BoardToken): Held
    {
        const radius = tokenRadius(this.#size);
        const ink = PALETTE[token.colour] ?? 0x888888;
        const spot = centreOf(token.col, token.row, this.#size);

        const halo = this.add.circle(spot.x, spot.y, radius * 1.45, 0xffffff, 0.22).setVisible(token.playable);
        const ring = this.add.circle(spot.x, spot.y, radius, RING, 0.35);
        const body = this.add.circle(spot.x, spot.y, radius * 0.92, ink);
        const gloss = this.add.circle(spot.x - radius * 0.26, spot.y - radius * 0.3, radius * 0.34, 0xffffff, 0.45);

        const mark = this.add.text(spot.x, spot.y, token.label, {
            fontFamily: 'system-ui, sans-serif',
            fontSize: `${ Math.round(radius * 0.95) }px`,
            color: '#ffffff'
        }).setOrigin(0.5, 0.5);

        body.setInteractive({ useHandCursor: true });
        body.on('pointerup', () => this.#options.onPick?.(token.key));

        return { token, body, gloss, ring, mark, halo };
    }

    #place(held: Held, animate: boolean): void
    {
        const radius = tokenRadius(this.#size);
        const spot = centreOf(held.token.col, held.token.row, this.#size);

        held.ring.setRadius(radius);
        held.body.setRadius(radius * 0.92);
        held.gloss.setRadius(radius * 0.34);
        held.halo.setRadius(radius * 1.45);
        held.mark.setFontSize(Math.round(radius * 0.95));

        const parts: { part: Phaser.GameObjects.GameObject & { x: number; y: number }; dx: number; dy: number }[] = [
            { part: held.halo, dx: 0, dy: 0 },
            { part: held.ring, dx: 0, dy: 0 },
            { part: held.body, dx: 0, dy: 0 },
            { part: held.gloss, dx: -radius * 0.26, dy: -radius * 0.3 },
            { part: held.mark, dx: 0, dy: 0 }
        ];

        for (const { part, dx, dy } of parts)
        {
            if (!animate)
            {
                part.x = spot.x + dx;
                part.y = spot.y + dy;
                continue;
            }

            this.tweens.add({
                targets: part,
                x: spot.x + dx,
                y: spot.y + dy,
                duration: 260,
                ease: 'Cubic.easeInOut'
            });
        }
    }
}

export async function createLudoBoard(options: BoardOptions): Promise<BoardHandle>
{
    const scene = new TableScene();
    const measure = (): number => Math.max(1, Math.round(options.host.getBoundingClientRect().width));

    const game = new Phaser.Game({
        type: Phaser.AUTO,
        parent: options.host,
        width: measure(),
        height: measure(),
        transparent: true,
        banner: false,
        autoFocus: false,
        audio: { noAudio: true },
        input: { keyboard: false, gamepad: false },
        scale: { mode: Phaser.Scale.NONE, autoCenter: Phaser.Scale.NO_CENTER },
        render: { antialias: true, roundPixels: true, powerPreference: 'low-power' },
        scene: [scene]
    });

    game.scene.start('table', options);

    const watcher = new ResizeObserver(() =>
    {
        const size = measure();

        game.scale.resize(size, size);
        scene.reflow(size);
    });

    watcher.observe(options.host);

    return {
        show: (tokens) => scene.paint(tokens),

        setReducedMotion: (on) => scene.setMotion(!on),

        resize: () =>
        {
            const size = measure();

            game.scale.resize(size, size);
            scene.reflow(size);
        },

        pause: () => game.loop.sleep(),

        resume: () => game.loop.wake(),

        /**
         * Phaser's destroy is DEFERRED - it sets a pending flag and tears down at the end of the
         * next game step. A slept loop never takes that step, so the WebGL context is never
         * released, which is precisely the leak this codebase has already hit twice with three.js.
         * Hence: wake the loop, destroy, drain the pending destroy directly, and only then lose the
         * context. The extension has to be captured BEFORE the destroy, because afterwards the
         * renderer is gone; and losing it first would make every texture delete a no-op and fill
         * the console with warnings, which is a failing gate in its own right.
         */
        dispose: () =>
        {
            watcher.disconnect();

            const renderer = game.renderer as { getExtension?: (name: string) => unknown } | undefined;
            const lose = renderer?.getExtension?.('WEBGL_lose_context') as { loseContext?: () => void } | undefined;

            game.loop.wake();
            game.destroy(true, false);

            (game as unknown as { runDestroy?: () => void }).runDestroy?.();

            lose?.loseContext?.();
        }
    };
}
