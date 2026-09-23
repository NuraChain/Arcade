import Phaser from 'phaser';

import { CELL, HOME_SCALE, centreOf, pickNear, stackSpot, tokenRadius } from '../layout.ts';
import { createSound, type SoundHandle } from '../sound.ts';
import { FINISHED, YARD, pathBetween, type LudoColour } from './path.ts';
import type { BoardHandle, BoardOptions, BoardToken, BoardView } from '../bridge.ts';

const PALETTE: Record<string, number> = {
    red: 0xe5392f,
    green: 0x1fa24c,
    yellow: 0xf7b814,
    blue: 0x2270e6
};

const DEEP: Record<string, string> = {
    red: '#72100C',
    green: '#075022',
    yellow: '#A45F04',
    blue: '#062F74'
};

const PAWN_SIZE = 256 / 170 / 0.40;

const PAWN_FOOT = 199 / 256;

const PAWN_DROP = 0.25;

const PAWN_HEAD = 0.25 - 0.762 / 0.40;

const SHADOW_TALL = 128 / 170 / 0.40;

const SHADOW_FOOT = 44 / 128;

const SHADOW_ALPHA = 0.6;

const RING_RADIUS = 1.40;

const MARK_MIN_CSS = 28;

const DIE_SHARE = 0.13 / 0.68;

const INK = 0x0b1220;

const GOLD = 0xe8c36a;

const BONE = 0xf6f1e6;

const STEP_MS = 120;

const HOP_MS = 300;

const FLIGHT_MS = 520;

const TUMBLE_MS = 520;

const DIE_HOLD_MS = 1100;

const CONFETTI = 28;

interface Held
{
    token: BoardToken;
    body: Phaser.GameObjects.Container;
    shadow: Phaser.GameObjects.Image;
    glow: Phaser.GameObjects.Ellipse;
    ring: Phaser.GameObjects.Container;
    dash: Phaser.GameObjects.Graphics;
    pawn: Phaser.GameObjects.Image;
    mark: Phaser.GameObjects.Text;
    motion: Phaser.Tweens.BaseTween[];
    walk: number;
    moving: boolean;
}

const EMPTY: BoardView = { tokens: [], die: null, turn: null, yours: false, winner: null };

const pieceOrder = (key: string): [number, number] =>
{
    const [seat, piece] = key.split('-').map(Number);

    return [seat ?? 0, piece ?? 0];
};

class TableScene extends Phaser.Scene
{
    #options!: BoardOptions;

    #plate?: Phaser.GameObjects.Image;

    #held = new Map<string, Held>();

    #size = 0;

    #dpr = 1;

    #motion = true;

    #sound: SoundHandle | null = null;

    #view: BoardView = EMPTY;

    #dieBox?: Phaser.GameObjects.Container;

    #die?: Phaser.GameObjects.Image;

    #dieGlow: Phaser.GameObjects.Arc[] = [];

    #dieFade?: Phaser.Time.TimerEvent;

    constructor()
    {
        super('table');
    }

    public init(options: BoardOptions & { dpr?: number }): void
    {
        this.#options = options;
        this.#motion = !options.reducedMotion;
        this.#dpr = options.dpr ?? 1;
    }

    public preload(): void
    {
        this.load.image('plate', this.#options.plate);
        this.load.image('pawn-shadow', '/board/pawn-shadow.webp');
        this.load.spritesheet('dice', '/board/ludo-dice.webp', { frameWidth: 256, frameHeight: 256 });

        for (const colour of Object.keys(PALETTE))
        {
            this.load.image(`pawn-${ colour }`, `/board/pawn-${ colour }.webp`);
        }
    }

    public create(): void
    {
        this.#size = this.scale.width;
        this.#sound = createSound(this.#options.sound);

        this.#plate = this.add.image(0, 0, 'plate').setOrigin(0, 0);
        this.#plate.setDisplaySize(this.#size, this.#size);

        this.#dieGlow = [0, 1, 2].map(() => this.add.circle(0, 0, 1, 0xffffff, 0));
        this.#die = this.add.image(0, 0, 'dice', 0);
        this.#dieBox = this.add.container(0, 0, [...this.#dieGlow, this.#die]).setVisible(false).setDepth(50);
        this.#placeDie();

        for (const token of this.#options.view.tokens)
        {
            this.#held.set(token.key, this.#mint(token));
        }

        this.#view = this.#options.view;
        this.#layout(false);

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
            this.#face(this.#view.die);
            this.#dieBox.setVisible(true);
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
            held.moving = false;
            this.#dress(held);
            this.#affordance(held);
        }

        this.#layout(false);
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

            if (was.col === token.col && was.row === token.row)
            {
                if (was.playable !== token.playable)
                {
                    this.#affordance(held);
                }
                continue;
            }

            this.#still(held);

            if (was.at === token.at || !this.#motion)
            {
                held.walk += 1;
                held.moving = false;
                this.#affordance(held);
                continue;
            }

            if (was.at >= 0 && token.at === YARD)
            {
                this.#knock(held);
                continue;
            }

            const path = pathBetween(token.colour as LudoColour, was.at, token.at);

            this.#walk(held, path, () => token.at === FINISHED ? this.#home(held) : this.#arrive(held));
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

        this.#layout(true);
        this.#roll(previous.die, next.die, next.turn);

        if (previous.winner === null && next.winner !== null)
        {
            this.#celebrate(next.winner);
        }
        else if (!previous.yours && next.yours && previous.winner === null)
        {
            this.#sound?.play('turn', { urgent: true });
        }
    }

    #mint(token: BoardToken): Held
    {
        const shadow = this.add.image(0, 0, 'pawn-shadow').setOrigin(0.5, SHADOW_FOOT).setAlpha(SHADOW_ALPHA);
        const glow = this.add.ellipse(0, 0, 1, 1, 0xffffff, 0.30);
        const dash = this.add.graphics();
        const ring = this.add.container(0, 0, [dash]).setScale(1, 0.5);
        const pawn = this.add.image(0, 0, `pawn-${ token.colour }`).setOrigin(0.5, PAWN_FOOT);
        const mark = this.add.text(0, 0, token.label, {
            fontFamily: 'Inter, system-ui, sans-serif',
            fontStyle: '800',
            color: DEEP[token.colour] ?? '#0b1220'
        }).setOrigin(0.5, 0.5).setAlpha(0.8);

        const spot = centreOf(token.col, token.row, this.#size);
        const body = this.add.container(spot.x, spot.y, [shadow, glow, ring, pawn, mark]).setDepth(this.#depthAt(spot.y));

        const held: Held = { token, body, shadow, glow, ring, dash, pawn, mark, motion: [], walk: 0, moving: false };

        pawn.on('pointerover', () => this.#select(held, true));
        pawn.on('pointerout', () => this.#select(held, false));

        this.#dress(held);
        this.#affordance(held);

        return held;
    }

    #radius(): number
    {
        return tokenRadius(this.#size);
    }

    #dress(held: Held): void
    {
        const radius = this.#radius();
        const lift = radius * PAWN_DROP;

        held.shadow.setPosition(0, lift).setDisplaySize(radius * PAWN_SIZE, radius * SHADOW_TALL);
        held.glow.setPosition(0, lift).setSize(radius * 1.25, radius * 0.625);
        held.ring.setPosition(0, lift);
        held.pawn.setPosition(0, lift).setDisplaySize(radius * PAWN_SIZE, radius * PAWN_SIZE);
        held.mark.setPosition(0, radius * PAWN_HEAD).setFontSize(Math.max(1, Math.round(radius * 0.85)));
        held.mark.setVisible(CELL * this.#size / this.#dpr >= MARK_MIN_CSS);
    }

    #depthAt(y: number): number
    {
        return 10 + y / Math.max(1, this.#size);
    }

    #drawRing(held: Held, solid: boolean): void
    {
        const radius = this.#radius();
        const reach = radius * RING_RADIUS;
        const dash = held.dash;

        dash.clear();
        dash.lineStyle(Math.max(1, radius * 0.25), INK, 0.55);
        dash.strokeCircle(0, 0, reach);
        dash.lineStyle(Math.max(1, radius * (solid ? 0.1875 : 0.1375)), 0xffffff, 0.95);

        if (solid)
        {
            dash.strokeCircle(0, 0, reach);
            return;
        }

        const pieces = 12;
        const arc = (Math.PI * 2) / pieces;

        for (let index = 0; index < pieces; index += 1)
        {
            dash.beginPath();
            dash.arc(0, 0, reach, index * arc, index * arc + arc * 0.75);
            dash.strokePath();
        }
    }

    #still(held: Held): void
    {
        for (const tween of held.motion)
        {
            tween.remove();
        }
        held.motion = [];

        const radius = this.#radius();

        this.tweens.killTweensOf([held.pawn, held.mark, held.shadow, held.dash]);
        held.pawn.setY(radius * PAWN_DROP).setDisplaySize(radius * PAWN_SIZE, radius * PAWN_SIZE).clearTint().setTintMode(Phaser.TintModes.MULTIPLY).setAngle(0);
        held.mark.setY(radius * PAWN_HEAD);
        held.shadow.setDisplaySize(radius * PAWN_SIZE, radius * SHADOW_TALL).setAlpha(SHADOW_ALPHA);
        held.dash.setAngle(0);
    }

    #affordance(held: Held): void
    {
        this.#still(held);

        const movable = held.token.playable;

        held.glow.setVisible(movable);
        held.ring.setVisible(movable);
        held.pawn.disableInteractive();

        if (!movable)
        {
            return;
        }

        held.pawn.setInteractive({ useHandCursor: true, hitArea: new Phaser.Geom.Rectangle(52, 15, 152, 230), hitAreaCallback: Phaser.Geom.Rectangle.Contains });

        const radius = this.#radius();

        if (!this.#motion)
        {
            this.#drawRing(held, true);
            held.pawn.setY(radius * (PAWN_DROP - 0.15));
            held.mark.setY(radius * (PAWN_HEAD - 0.15));
            held.shadow.setAlpha(SHADOW_ALPHA * 0.9);
            return;
        }

        this.#drawRing(held, false);

        const hop = radius * 0.25;
        const sx = held.pawn.scaleX;
        const sy = held.pawn.scaleY;
        const shadowX = held.shadow.scaleX;
        const shadowY = held.shadow.scaleY;
        const stagger = (pieceOrder(held.token.key)[1] % 4) * 90;

        held.motion.push(this.tweens.add({ targets: held.dash, angle: 360, duration: 2400, repeat: -1, ease: 'Linear' }));

        held.motion.push(this.tweens.chain({
            loop: -1,
            delay: stagger,
            tweens: [
                {
                    targets: [held.pawn, held.mark],
                    y: `-=${ hop }`,
                    duration: HOP_MS,
                    ease: 'Sine.easeOut',
                    onStart: () =>
                    {
                        this.tweens.add({
                            targets: held.shadow,
                            scaleX: shadowX * 0.85,
                            scaleY: shadowY * 0.85,
                            alpha: SHADOW_ALPHA * 0.75,
                            duration: HOP_MS,
                            yoyo: true,
                            ease: 'Sine.easeOut'
                        });
                    }
                },
                { targets: [held.pawn, held.mark], y: `+=${ hop }`, duration: HOP_MS, ease: 'Sine.easeIn' },
                { targets: held.pawn, scaleX: sx * 1.05, scaleY: sy * 0.93, duration: 90, yoyo: true, ease: 'Sine.easeOut' },
                { targets: held.pawn, alpha: 1, duration: 420 }
            ]
        }));
    }

    #select(held: Held, on: boolean): void
    {
        if (!held.token.playable || held.moving)
        {
            return;
        }

        this.#drawRing(held, on || !this.#motion);

        const spot = this.#spotOf(held);

        this.tweens.add({
            targets: held.body,
            scale: spot.scale * (on && this.#motion ? 1.06 : 1),
            duration: on ? 100 : 120,
            ease: 'Sine.easeOut'
        });
    }

    #spotOf(held: Held): { x: number; y: number; scale: number }
    {
        const token = held.token;
        const base = centreOf(token.col, token.row, this.#size);

        if (token.at === FINISHED)
        {
            return { ...base, scale: HOME_SCALE };
        }

        if (token.at === YARD)
        {
            return { ...base, scale: 1 };
        }

        const together = this.#view.tokens
            .filter((one) => one.at !== YARD && one.at !== FINISHED && one.col === token.col && one.row === token.row)
            .map((one) => one.key)
            .sort((a, b) =>
            {
                const [seatA, pieceA] = pieceOrder(a);
                const [seatB, pieceB] = pieceOrder(b);

                return seatA - seatB || pieceA - pieceB;
            });

        const place = stackSpot(Math.max(0, together.indexOf(token.key)), together.length);
        const cell = CELL * this.#size;

        return { x: base.x + place.dx * cell, y: base.y + place.dy * cell, scale: place.scale };
    }

    #layout(animate: boolean): void
    {
        for (const held of this.#held.values())
        {
            if (held.moving)
            {
                continue;
            }

            const spot = this.#spotOf(held);

            held.body.setDepth(this.#depthAt(spot.y));

            if (!animate || !this.#motion || (held.body.x === spot.x && held.body.y === spot.y && held.body.scale === spot.scale))
            {
                this.tweens.killTweensOf(held.body);
                held.body.setPosition(spot.x, spot.y).setScale(spot.scale).setAngle(0).setAlpha(1);
                continue;
            }

            this.tweens.add({ targets: held.body, x: spot.x, y: spot.y, scale: spot.scale, duration: 140, ease: 'Sine.easeOut' });
        }
    }

    #arrive(held: Held): void
    {
        held.moving = false;
        this.#affordance(held);
        this.#layout(true);

        if (!this.#motion)
        {
            return;
        }

        const sx = held.pawn.scaleX;
        const sy = held.pawn.scaleY;

        this.tweens.add({ targets: held.pawn, scaleX: sx * 1.05, scaleY: sy * 0.93, duration: 90, yoyo: true, ease: 'Sine.easeOut' });
    }

    #walk(held: Held, cells: readonly { col: number; row: number }[], done: () => void): void
    {
        const id = held.walk + 1;

        held.walk = id;
        held.moving = true;

        if (cells.length === 0)
        {
            done();
            return;
        }

        const radius = this.#radius();
        const arc = radius * 0.55;

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

            this.tweens.add({ targets: [held.pawn, held.mark], y: `-=${ arc }`, duration: STEP_MS / 2, yoyo: true, ease: 'Sine.easeOut' });
            this.tweens.add({ targets: held.shadow, scaleX: held.shadow.scaleX * 0.8, scaleY: held.shadow.scaleY * 0.8, duration: STEP_MS / 2, yoyo: true });

            this.tweens.add({
                targets: held.body,
                x: spot.x,
                y: spot.y,
                scale: 1,
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

    #burst(x: number, y: number, colour: number): void
    {
        const radius = this.#radius();
        const ring = this.add.ellipse(x, y + radius * PAWN_DROP, radius * 0.875, radius * 0.4375)
            .setStrokeStyle(Math.max(1, radius * 0.15), colour, 0.9)
            .setFillStyle(0xffffff, 0)
            .setDepth(this.#depthAt(y) + 2);

        this.tweens.add({
            targets: ring,
            scale: 0.95 / 0.35,
            alpha: 0,
            duration: 280,
            ease: 'Quad.easeOut',
            onComplete: () => ring.destroy()
        });
    }

    #knock(held: Held): void
    {
        const id = held.walk + 1;

        held.walk = id;
        held.moving = true;

        const from = { x: held.body.x, y: held.body.y };
        const spot = centreOf(held.token.col, held.token.row, this.#size);
        const radius = this.#radius();

        this.#sound?.play('token-capture');
        this.#burst(from.x, from.y, 0xffffff);

        held.pawn.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL);
        this.time.delayedCall(70, () => held.pawn.clearTint().setTintMode(Phaser.TintModes.MULTIPLY));

        held.body.setDepth(60);

        this.tweens.add({ targets: held.shadow, alpha: 0, duration: 120 });
        this.tweens.add({ targets: held.shadow, alpha: SHADOW_ALPHA, delay: FLIGHT_MS - 120, duration: 120 });
        this.tweens.add({ targets: [held.pawn, held.mark], y: `-=${ radius * 2.75 }`, duration: FLIGHT_MS / 2, yoyo: true, ease: 'Quad.easeOut' });
        this.tweens.add({ targets: held.body, angle: 360, duration: FLIGHT_MS, ease: 'Cubic.easeOut' });
        this.tweens.add({ targets: held.body, scale: 1.2, duration: FLIGHT_MS / 2, yoyo: true, ease: 'Sine.easeInOut' });

        this.tweens.add({
            targets: held.body,
            x: spot.x,
            y: spot.y,
            duration: FLIGHT_MS,
            ease: 'Quad.easeInOut',
            onComplete: () =>
            {
                if (held.walk !== id || held.body.scene === undefined)
                {
                    return;
                }

                held.body.setAngle(0).setScale(0.9).setDepth(this.#depthAt(spot.y));
                held.moving = false;
                this.#affordance(held);

                this.tweens.add({ targets: held.body, scale: 1, duration: 160, ease: 'Back.easeOut' });
            }
        });
    }

    #home(held: Held): void
    {
        const spot = this.#spotOf(held);

        this.#sound?.play('home');

        this.tweens.add({
            targets: held.body,
            x: spot.x,
            y: spot.y,
            scale: HOME_SCALE,
            duration: 220,
            ease: 'Cubic.easeOut',
            onComplete: () =>
            {
                held.moving = false;
                held.body.setDepth(this.#depthAt(spot.y));
                this.#burst(spot.x, spot.y, GOLD);
                this.#affordance(held);
            }
        });
    }

    #retire(held: Held): void
    {
        for (const tween of held.motion)
        {
            tween.remove();
        }

        this.tweens.add({
            targets: held.body,
            alpha: 0,
            duration: this.#motion ? 200 : 0,
            onComplete: () => held.body.destroy(true)
        });
    }

    #placeDie(): void
    {
        const cell = CELL * this.#size;

        this.#dieBox?.setPosition(this.#size / 2, this.#size / 2);
        this.#die?.setDisplaySize(this.#size * DIE_SHARE, this.#size * DIE_SHARE);
        this.#dieGlow.forEach((circle, index) => circle.setRadius(cell * (1.5 - index * 0.3)));
    }

    #face(value: number): void
    {
        this.#die?.setFrame(Math.min(Math.max(value, 1), 6) - 1);
    }

    #glow(turn: string | null): void
    {
        const tint = turn === null ? null : (PALETTE[turn] ?? null);

        this.#dieGlow.forEach((circle, index) =>
        {
            circle.setFillStyle(tint ?? 0xffffff, tint === null ? 0 : 0.12 + index * 0.02);
        });
    }

    #roll(was: number | null, now: number | null, turn: string | null): void
    {
        const box = this.#dieBox;
        const die = this.#die;

        if (box === undefined || die === undefined)
        {
            return;
        }

        this.#dieFade?.remove();
        this.#dieFade = undefined;

        if (now === null)
        {
            this.tweens.killTweensOf([box, die]);
            box.setVisible(false);
            return;
        }

        if (was === now)
        {
            return;
        }

        this.#sound?.play('die-land');
        this.#placeDie();
        this.tweens.killTweensOf([box, die]);
        this.#glow(null);

        box.setVisible(true).setAlpha(1);
        die.setAngle(0);
        this.#placeDie();

        if (!this.#motion)
        {
            this.#face(now);
            this.#glow(turn);
            this.#fadeDie();
            return;
        }

        const faces = 7;
        let shown = 0;

        this.#face((now * 7) % 6 + 1);

        this.time.addEvent({
            delay: TUMBLE_MS / faces,
            repeat: faces - 1,
            callback: () =>
            {
                shown += 1;
                this.#face(shown >= faces ? now : (now * 7 + shown * 3) % 6 + 1);

                if (shown >= faces)
                {
                    this.#glow(turn);
                    this.#fadeDie();
                }
            }
        });

        const base = die.scaleX;

        this.tweens.add({ targets: die, angle: 360, duration: TUMBLE_MS, ease: 'Cubic.easeOut' });
        this.tweens.add({ targets: die, scaleX: base * 1.3, scaleY: base * 1.3, duration: TUMBLE_MS * 0.4, yoyo: true, ease: 'Sine.easeInOut' });
    }

    #fadeDie(): void
    {
        const box = this.#dieBox;

        if (box === undefined)
        {
            return;
        }

        this.#dieFade = this.time.delayedCall(DIE_HOLD_MS, () =>
        {
            this.tweens.add({
                targets: box,
                alpha: 0,
                duration: 260,
                onComplete: () => box.setVisible(false)
            });
        });
    }

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

const BOOT_MS = 8000;

export async function createLudoBoard(options: BoardOptions): Promise<BoardHandle>
{
    const scene = new TableScene();
    const dpr = Math.min(Math.max(window.devicePixelRatio || 1, 1), 3);
    const measure = (): number => Math.max(1, Math.round(options.host.getBoundingClientRect().width * dpr));

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
        render: { antialias: true, roundPixels: false, powerPreference: 'low-power', mipmapFilter: 'LINEAR_MIPMAP_LINEAR' },
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
        dpr,
        onReady: () =>
        {
            clearTimeout(timer);
            booted();
            options.onReady?.();
        }
    });

    const release = (): void =>
    {
        const renderer = game.renderer as { getExtension?: (name: string) => unknown } | undefined;
        const lose = renderer?.getExtension?.('WEBGL_lose_context') as { loseContext?: () => void } | undefined;

        game.loop.wake();
        game.destroy(true, false);

        (game as unknown as { runDestroy?: () => void }).runDestroy?.();

        lose?.loseContext?.();
    };

    try
    {
        await up;
    }
    catch (reason)
    {
        clearTimeout(timer);
        release();
        throw reason;
    }

    const fit = (): void =>
    {
        const size = measure();

        game.scale.resize(size, size);
        game.scale.refresh();
        scene.reflow(size);
    };

    const watcher = new ResizeObserver(fit);

    watcher.observe(options.host);

    return {
        show: (view) => scene.show(view),

        setReducedMotion: (on) => scene.setMotion(!on),

        setSound: (on) => scene.setSound(on),

        resize: fit,

        pause: () => game.loop.sleep(),

        resume: () => game.loop.wake(),

        dispose: () =>
        {
            watcher.disconnect();
            scene.hush();
            release();
        }
    };
}
