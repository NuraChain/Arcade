import Phaser from 'phaser';

import { GRID, centreOf, pickNear, tokenRadius } from '../layout.ts';
import { createSound, type SoundHandle } from '../sound.ts';
import { FINISHED, YARD, pathBetween, type LudoColour } from './path.ts';
import type { BoardHandle, BoardOptions, BoardToken, BoardView } from '../bridge.ts';

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
 *                nothing plays. The table's own cues are in `game/sound.ts`, which does not open a
 *                context until a gesture has been through the window.
 *   keyboard     Phaser's keyboard plugin attaches a document listener and preventDefaults space and
 *                the arrows. The keyboard belongs entirely to the DOM controls beside this canvas -
 *                that is how the game is playable without a pointer.
 *   autoFocus    the default calls window.focus() on boot, which steals focus mid-navigation.
 *   banner       a console.log the matrix would read.
 *   Scale.NONE   RESIZE listens to the window, and this canvas changes size without one: the chat
 *                rail opening, the posture flipping at 768 and 1024, an overlay sheet. A
 *                ResizeObserver on the host is the only thing that sees all three.
 *
 * **The motion is where a move stops being a diff and becomes a thing that happened.** A token walks
 * the squares it really passed over - `pathBetween` asks the server's own board module which ones
 * those are, rather than the renderer guessing a straight line through the middle of the board - a
 * captured token is knocked back to its yard rather than teleporting, and a die tumbles before it
 * says what it rolled. None of it decides anything: every frame of it is the same authoritative
 * state arriving, drawn over time instead of at once. A second update landing mid-walk cancels the
 * first and walks from wherever the token had got to, because the newest state is always the one
 * worth being on the way to.
 */

const PALETTE: Record<string, number> = {
    red: 0xe5392f,
    green: 0x1fa24c,
    yellow: 0xf7b814,
    blue: 0x2270e6
};

const PAWN_WIDE = 2.6;

const PAWN_TALL = PAWN_WIDE * 1.2;

const PAWN_FOOT = 0.82;

const PAWN_HEAD = (33 / 120 - PAWN_FOOT) * PAWN_TALL;

const PLATE_PIXELS = 1536;

const INK = 0x2b1d12;

const BONE = 0xf6f1e6;

/** One square of a walk. Fast enough that a six does not hold the turn up, slow enough to follow. */
const STEP_MS = 105;

const KNOCK_MS = 430;

const TUMBLE_MS = 520;

const DIE_HOLD_MS = 1100;

const CONFETTI = 28;

/** Which of the seven pip positions each face lights, as columns and rows in -1..1. */
const PIPS: Record<number, readonly (readonly [number, number])[]> = {
    1: [[0, 0]],
    2: [[-1, -1], [1, 1]],
    3: [[-1, -1], [0, 0], [1, 1]],
    4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
    5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]],
    6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]]
};

interface Held
{
    token: BoardToken;
    body: Phaser.GameObjects.Container;
    halo: Phaser.GameObjects.Arc;
    haloEdge: Phaser.GameObjects.Arc;
    pawn: Phaser.GameObjects.Image;
    mark: Phaser.GameObjects.Text;
    pulse: Phaser.Tweens.Tween | null;
    walk: number;
}

const EMPTY: BoardView = { tokens: [], die: null, turn: null, yours: false, winner: null };

class TableScene extends Phaser.Scene
{
    #options!: BoardOptions;

    #plate?: Phaser.GameObjects.Image;

    #held = new Map<string, Held>();

    #size = 0;

    #motion = true;

    #sound: SoundHandle | null = null;

    #view: BoardView = EMPTY;

    #die?: Phaser.GameObjects.Graphics;

    #dieFade?: Phaser.Time.TimerEvent;

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
        this.load.svg('plate', this.#options.plate, { width: PLATE_PIXELS, height: PLATE_PIXELS });

        for (const colour of Object.keys(PALETTE))
        {
            this.load.svg(`pawn-${ colour }`, `/board/pawn-${ colour }.svg`, { width: 200, height: 240 });
        }
    }

    public create(): void
    {
        this.#size = this.scale.width;
        this.#sound = createSound(this.#options.sound);

        this.#plate = this.add.image(0, 0, 'plate').setOrigin(0, 0);
        this.#plate.setDisplaySize(this.#size, this.#size);

        const die = this.add.graphics().setVisible(false).setDepth(50);

        this.#die = die;

        for (const token of this.#options.view.tokens)
        {
            this.#held.set(token.key, this.#mint(token));
        }

        this.#view = this.#options.view;

        this.input.on('pointerup', (pointer: { x: number; y: number }) =>
        {
            const key = pickNear(this.#view.tokens, pointer.x, pointer.y, this.#size);

            if (key !== null)
            {
                this.#options.onPick?.(key);
            }
        });

        if (this.#view.die !== null)
        {
            this.#placeDie();
            this.#drawDie(this.#view.die);
            die.setVisible(true);
            this.#fadeDie();
        }

        this.#options.onReady?.();
    }

    public reflow(size: number): void
    {
        this.#size = size;

        this.#plate?.setDisplaySize(size, size);

        for (const held of this.#held.values())
        {
            held.walk += 1;
            this.#resizeToken(held);
            this.#settle(held);
        }

        this.#placeDie();
    }

    public setMotion(on: boolean): void
    {
        this.#motion = on;

        for (const held of this.#held.values())
        {
            this.#affordance(held);
        }
    }

    public setSound(on: boolean): void
    {
        this.#sound?.setEnabled(on);
    }

    public hush(): void
    {
        this.#sound?.dispose();
        this.#sound = null;
    }

    /**
     * The authoritative board, drawn over time.
     *
     * Everything this reads is a comparison between the view it was last given and the one it has
     * now - which token gained ground, which one went back to its yard, which one left the board
     * because it came home. The server already decided all three; the only thing decided here is how
     * long each takes.
     */
    public show(next: BoardView): void
    {
        const previous = this.#view;

        this.#view = next;

        const seen = new Set<string>();

        for (const token of next.tokens)
        {
            seen.add(token.key);

            const held = this.#held.get(token.key);

            if (held === undefined)
            {
                this.#held.set(token.key, this.#mint(token));
                continue;
            }

            const was = held.token;

            held.token = token;

            this.#affordance(held);

            if (was.col === token.col && was.row === token.row)
            {
                continue;
            }

            /**
             * A token can move without going anywhere: the four wells in a yard are filled in order,
             * so the last one home shuffles along when a neighbour leaves. Walking that would send it
             * out to the entry square and back, because a walk from the yard is defined as the step
             * onto the board.
             */
            if (was.at === token.at)
            {
                held.walk += 1;
                this.#settle(held);
                continue;
            }

            if (!this.#motion)
            {
                held.walk += 1;
                this.#settle(held);
                continue;
            }

            if (was.at >= 0 && token.at === YARD)
            {
                this.#knock(held);
                continue;
            }

            this.#walk(held, pathBetween(token.colour as LudoColour, was.at, token.at), () => this.#settle(held));
        }

        for (const [key, held] of [...this.#held])
        {
            if (seen.has(key))
            {
                continue;
            }

            this.#held.delete(key);
            this.#retire(held);
        }

        this.#roll(previous.die, next.die);

        if (previous.winner === null && next.winner !== null)
        {
            this.#celebrate(next.winner);
        }
        else if (!previous.yours && next.yours && previous.winner === null)
        {
            this.#sound?.play('turn', { urgent: true });
        }
    }

    // ------------------------------------------------------------------ tokens

    #mint(token: BoardToken): Held
    {
        const radius = tokenRadius(this.#size);
        const spot = centreOf(token.col, token.row, this.#size);

        const haloEdge = this.add.circle(0, 0, radius * 1.46, INK, 0).setStrokeStyle(Math.max(1, radius * 0.34), INK, 0.55);
        const halo = this.add.circle(0, 0, radius * 1.46, INK, 0).setStrokeStyle(Math.max(1, radius * 0.2), 0xffffff, 0.95);
        const pawn = this.add.image(0, 0, `pawn-${ token.colour }`)
            .setOrigin(0.5, PAWN_FOOT)
            .setDisplaySize(radius * PAWN_WIDE, radius * PAWN_TALL);

        const mark = this.add.text(0, radius * PAWN_HEAD, token.label, {
            fontFamily: 'Inter, system-ui, sans-serif',
            fontSize: `${ Math.round(radius * 0.62) }px`,
            fontStyle: '800',
            color: '#ffffff',
            stroke: '#0b1220',
            strokeThickness: Math.max(1, radius * 0.1)
        }).setOrigin(0.5, 0.5).setAlpha(0.92);

        const body = this.add.container(spot.x, spot.y, [haloEdge, halo, pawn, mark]).setDepth(this.#depthAt(spot.y));

        pawn.setInteractive({ useHandCursor: true });
        pawn.on('pointerover', () => body.setScale(this.#motion ? 1.08 : 1));
        pawn.on('pointerout', () => body.setScale(1));

        const held: Held = { token, body, halo, haloEdge, pawn, mark, pulse: null, walk: 0 };

        this.#affordance(held);

        return held;
    }

    #resizeToken(held: Held): void
    {
        const radius = tokenRadius(this.#size);

        held.halo.setRadius(radius * 1.46);
        held.halo.setStrokeStyle(Math.max(1, radius * 0.2), 0xffffff, 0.95);
        held.haloEdge.setRadius(radius * 1.46);
        held.haloEdge.setStrokeStyle(Math.max(1, radius * 0.34), INK, 0.55);
        held.pawn.setDisplaySize(radius * PAWN_WIDE, radius * PAWN_TALL);
        held.mark.setPosition(0, radius * PAWN_HEAD);
        held.mark.setFontSize(Math.round(radius * 0.62));
        held.mark.setStroke('#0b1220', Math.max(1, radius * 0.1));
    }

    #depthAt(y: number): number
    {
        return 10 + y / Math.max(1, this.#size);
    }

    /**
     * The halo is the only thing on the canvas that says a token can be moved, and it has to read on
     * every ground this board has: cream paper, walnut rim, and four saturated yards. A glow in the
     * TOKEN's own colour was the first attempt and it is invisible exactly where it matters most - a
     * red ring around a red piece sitting in the red yard, which is where every game begins. So it
     * is two strokes, white inside a dark one, the trick a map legend uses: the white carries on
     * walnut and on red, the dark carries on cream, and neither depends on which colour is playing.
     *
     * It breathes while it waits, because a static ring reads as something printed on the board -
     * and it does not breathe under reduced motion, where the two strokes have to carry it alone.
     */
    #affordance(held: Held): void
    {
        held.pulse?.remove();
        held.pulse = null;

        for (const part of [held.halo, held.haloEdge])
        {
            part.setVisible(held.token.playable);
            part.setAlpha(1);
            part.setScale(1);
        }

        if (!held.token.playable || !this.#motion)
        {
            return;
        }

        held.pulse = this.tweens.add({
            targets: [held.halo, held.haloEdge],
            scale: 1.16,
            alpha: 0.45,
            duration: 760,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut'
        });
    }

    #settle(held: Held): void
    {
        const spot = centreOf(held.token.col, held.token.row, this.#size);

        held.body.setPosition(spot.x, spot.y);
        held.body.setDepth(this.#depthAt(spot.y));
        held.body.setScale(1);
        held.body.setAngle(0);
    }

    #walk(held: Held, cells: readonly { col: number; row: number }[], done: () => void): void
    {
        const id = held.walk + 1;

        held.walk = id;

        if (cells.length === 0)
        {
            done();
            return;
        }

        const step = (index: number): void =>
        {
            if (held.walk !== id || held.body.scene === undefined)
            {
                return;
            }

            if (index >= cells.length)
            {
                done();
                return;
            }

            const spot = centreOf(cells[index].col, cells[index].row, this.#size);

            held.body.setDepth(this.#depthAt(Math.max(spot.y, held.body.y)) + 1);

            this.tweens.add({
                targets: held.body,
                scale: 1.14,
                duration: STEP_MS / 2,
                yoyo: true,
                ease: 'Sine.easeOut'
            });

            this.tweens.add({
                targets: held.body,
                x: spot.x,
                y: spot.y,
                duration: STEP_MS,
                ease: 'Sine.easeInOut',
                onComplete: () =>
                {
                    this.#sound?.play('token-step');
                    step(index + 1);
                }
            });
        };

        step(0);
    }

    /**
     * A captured token does not appear in its yard, it is sent there. The spin is what makes it read
     * as something done TO the piece rather than a move its owner chose, which is the whole of what a
     * capture is.
     */
    #knock(held: Held): void
    {
        const id = held.walk + 1;

        held.walk = id;

        const spot = centreOf(held.token.col, held.token.row, this.#size);

        this.#sound?.play('token-capture');

        this.tweens.add({
            targets: held.body,
            scale: 1.45,
            angle: 380,
            duration: KNOCK_MS * 0.45,
            ease: 'Quad.easeOut'
        });

        this.tweens.add({
            targets: held.body,
            x: spot.x,
            y: spot.y,
            duration: KNOCK_MS,
            ease: 'Quad.easeInOut',
            onComplete: () =>
            {
                if (held.walk !== id || held.body.scene === undefined)
                {
                    return;
                }

                held.body.setAngle(0);
                held.body.setDepth(this.#depthAt(spot.y));

                this.tweens.add({
                    targets: held.body,
                    scale: 1,
                    duration: 160,
                    ease: 'Back.easeOut'
                });
            }
        });
    }

    /**
     * A token leaves the board exactly once, by coming home, and the view it leaves in is one where
     * it is simply absent - so the walk it never got to make is reconstructed here from where it
     * stood. Destroying it the moment the list shortens is what made a finished token vanish from
     * under the pointer that had just moved it.
     */
    #retire(held: Held): void
    {
        const end = (): void =>
        {
            this.#sound?.play('home');

            this.tweens.add({
                targets: held.body,
                x: centreOf((GRID - 1) / 2, (GRID - 1) / 2, this.#size).x,
                y: centreOf((GRID - 1) / 2, (GRID - 1) / 2, this.#size).y,
                scale: 0.1,
                alpha: 0,
                duration: 420,
                ease: 'Cubic.easeIn',
                onComplete: () => held.body.destroy(true)
            });
        };

        held.pulse?.remove();
        held.pulse = null;

        if (!this.#motion || held.token.at < 0)
        {
            held.body.destroy(true);
            return;
        }

        this.#walk(held, pathBetween(held.token.colour as LudoColour, held.token.at, FINISHED), end);
    }

    // ------------------------------------------------------------------ the die

    #placeDie(): void
    {
        this.#die?.setPosition(this.#size / 2, this.#size * 0.5);
    }

    #roll(was: number | null, now: number | null): void
    {
        const die = this.#die;

        if (die === undefined)
        {
            return;
        }

        this.#dieFade?.remove();
        this.#dieFade = undefined;

        if (now === null)
        {
            this.tweens.killTweensOf(die);
            die.setVisible(false);
            return;
        }

        if (was === now)
        {
            return;
        }

        this.#sound?.play('die-land');
        this.#placeDie();
        this.tweens.killTweensOf(die);

        die.setVisible(true).setAlpha(1).setScale(1).setAngle(0);

        if (!this.#motion)
        {
            this.#drawDie(now);
            this.#fadeDie();
            return;
        }

        const faces = 7;
        let shown = 0;

        this.#drawDie((now * 7) % 6 + 1);

        this.time.addEvent({
            delay: TUMBLE_MS / faces,
            repeat: faces - 1,
            callback: () =>
            {
                shown += 1;
                this.#drawDie(shown >= faces ? now : (now * 7 + shown * 3) % 6 + 1);

                if (shown >= faces)
                {
                    this.#fadeDie();
                }
            }
        });

        this.tweens.add({
            targets: die,
            angle: 420,
            duration: TUMBLE_MS,
            ease: 'Cubic.easeOut'
        });

        this.tweens.add({
            targets: die,
            scale: 1.3,
            duration: TUMBLE_MS * 0.4,
            yoyo: true,
            ease: 'Sine.easeInOut'
        });
    }

    #fadeDie(): void
    {
        const die = this.#die;

        if (die === undefined)
        {
            return;
        }

        this.#dieFade = this.time.delayedCall(DIE_HOLD_MS, () =>
        {
            this.tweens.add({
                targets: die,
                alpha: 0,
                duration: 260,
                onComplete: () => die.setVisible(false)
            });
        });
    }

    #drawDie(face: number): void
    {
        const die = this.#die;

        if (die === undefined)
        {
            return;
        }

        const side = this.#size * 0.13;
        const half = side / 2;

        die.clear();

        die.fillStyle(INK, 0.22);
        die.fillRoundedRect(-half + side * 0.05, -half + side * 0.07, side, side, side * 0.2);

        die.fillStyle(BONE, 1);
        die.fillRoundedRect(-half, -half, side, side, side * 0.2);

        die.lineStyle(Math.max(1, side * 0.035), INK, 0.45);
        die.strokeRoundedRect(-half, -half, side, side, side * 0.2);

        die.fillStyle(INK, 1);

        for (const [col, row] of PIPS[face] ?? PIPS[1])
        {
            die.fillCircle(col * side * 0.27, row * side * 0.27, side * 0.085);
        }
    }

    // ------------------------------------------------------------------ the win

    #celebrate(winner: string): void
    {
        this.#sound?.play('win');

        const ink = PALETTE[winner] ?? 0xffffff;
        const centre = this.#size / 2;

        if (!this.#motion)
        {
            const flash = this.add.circle(centre, centre, this.#size * 0.3, ink, 0.35).setDepth(60);

            this.time.delayedCall(900, () => flash.destroy());
            return;
        }

        for (let index = 0; index < CONFETTI; index += 1)
        {
            const angle = (index / CONFETTI) * Math.PI * 2 + (index % 5) * 0.11;
            const reach = this.#size * (0.26 + (index % 7) * 0.035);
            const tint = index % 3 === 0 ? ink : (index % 3 === 1 ? BONE : 0xffffff);

            const fleck = this.add
                .rectangle(centre, centre, this.#size * 0.014, this.#size * 0.026, tint)
                .setDepth(60)
                .setAngle(index * 37);

            this.tweens.add({
                targets: fleck,
                x: centre + Math.cos(angle) * reach,
                y: centre + Math.sin(angle) * reach + this.#size * 0.08,
                angle: index * 37 + 540,
                alpha: 0,
                duration: 1100 + (index % 6) * 90,
                ease: 'Cubic.easeOut',
                onComplete: () => fleck.destroy()
            });
        }
    }
}

/**
 * `scene.start` does not start a scene, it QUEUES one: `init`, `preload` and `create` run on the
 * next step of the game loop, so everything the scene owns - its size, its plate, its die - is
 * absent for a frame or two after this function would otherwise have returned. A caller that shows
 * a board into that window throws inside Phaser, and a component that catches the throw concludes
 * the renderer failed and draws its fallback ON TOP of a canvas that is working perfectly. In LTR
 * the two layers land on the same squares and nothing looks wrong at all; it took a Persian page,
 * where the fallback mirrors and the canvas does not, to see it.
 *
 * So the handle is not handed out until the scene says it is up. The timeout is what keeps a failure
 * a failure: a scene that never boots must reject, so the component can fall back once and properly,
 * rather than awaiting something that is never coming.
 */
const BOOT_MS = 8000;

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

    let booted: () => void = () => undefined;
    let failed: (reason: Error) => void = () => undefined;

    const up = new Promise<void>((resolve, reject) =>
    {
        booted = resolve;
        failed = reject;
    });

    const timer = setTimeout(() => failed(new Error('the board did not boot')), BOOT_MS);

    game.scene.start('table', {
        ...options,
        onReady: () =>
        {
            clearTimeout(timer);
            booted();
            options.onReady?.();
        }
    });

    try
    {
        await up;
    }
    catch (reason)
    {
        clearTimeout(timer);

        /*
         * The same three steps `dispose` takes, and for the same reason it states: Phaser's destroy
         * is DEFERRED, so without draining it and losing the context by hand the context is left for
         * the garbage collector rather than released.
         *
         * This path is the one a struggling device takes - a scene that never boots, or boots past
         * its watchdog - and `board-canvas` catches the throw and draws the DOM fallback. So the
         * device least able to afford an orphaned context was the one getting one, and getting
         * another every time somebody opened a board.
         */
        const renderer = game.renderer as { getExtension?: (name: string) => unknown } | undefined;
        const lose = renderer?.getExtension?.('WEBGL_lose_context') as { loseContext?: () => void } | undefined;

        game.loop.wake();
        game.destroy(true, false);

        (game as unknown as { runDestroy?: () => void }).runDestroy?.();

        lose?.loseContext?.();

        throw reason;
    }

    const watcher = new ResizeObserver(() =>
    {
        const size = measure();

        game.scale.resize(size, size);
        scene.reflow(size);
    });

    watcher.observe(options.host);

    return {
        show: (view) => scene.show(view),

        setReducedMotion: (on) => scene.setMotion(!on),

        setSound: (on) => scene.setSound(on),

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
         *
         * The audio context is closed FIRST and by hand: it is not Phaser's - Phaser's own is turned
         * off - so nothing in that teardown knows it exists, and a context left open holds a real
         * device handle for a board that has left the page.
         */
        dispose: () =>
        {
            watcher.disconnect();
            scene.hush();

            const renderer = game.renderer as { getExtension?: (name: string) => unknown } | undefined;
            const lose = renderer?.getExtension?.('WEBGL_lose_context') as { loseContext?: () => void } | undefined;

            game.loop.wake();
            game.destroy(true, false);

            (game as unknown as { runDestroy?: () => void }).runDestroy?.();

            lose?.loseContext?.();
        }
    };
}
