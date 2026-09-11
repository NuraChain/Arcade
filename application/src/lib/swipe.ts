export type DragAxis = 'x' | 'y';

export interface DragOptions
{
    threshold: number;
    velocity: number;
    axis?: DragAxis;
    lock?: number;
    allowNegative?: boolean;
}

export interface DragFrame
{
    offset: number;
    axis: DragAxis | null;
    dismiss: boolean;
}

export interface Drag
{
    start(x: number, y: number, at: number): void;
    move(x: number, y: number, at: number): DragFrame;
    end(at: number): DragFrame;
    active(): boolean;
    axis(): DragAxis | null;
    speed(): number;
}

const IDLE: DragFrame = { offset: 0, axis: null, dismiss: false };

export function createDrag(options: DragOptions): Drag
{
    const wanted = options.axis ?? 'y';
    const lock = options.lock ?? 8;
    const signed = options.allowNegative === true;

    let originX = 0;
    let originY = 0;
    let last = 0;
    let lastAt = 0;
    let speed = 0;
    let locked: DragAxis | null = null;
    let tracking = false;

    const along = (x: number, y: number): number => (wanted === 'y' ? y - originY : x - originX);

    const clamp = (value: number): number => (signed ? value : Math.max(0, value));

    return {
        start(x, y, at)
        {
            originX = x;
            originY = y;
            last = wanted === 'y' ? y : x;
            lastAt = at;
            speed = 0;
            locked = null;
            tracking = true;
        },

        move(x, y, at)
        {
            if (!tracking)
            {
                return IDLE;
            }

            if (locked === null)
            {
                const dx = Math.abs(x - originX);
                const dy = Math.abs(y - originY);
                if (Math.max(dx, dy) < lock)
                {
                    return { offset: 0, axis: null, dismiss: false };
                }
                locked = dx > dy ? 'x' : 'y';
                if (locked !== wanted)
                {
                    tracking = false;
                    return { offset: 0, axis: locked, dismiss: false };
                }
            }

            const current = wanted === 'y' ? y : x;
            const elapsed = Math.max(1, at - lastAt);
            speed = (current - last) / elapsed;
            last = current;
            lastAt = at;

            return { offset: clamp(along(x, y)), axis: locked, dismiss: false };
        },

        end(at)
        {
            if (!tracking)
            {
                return IDLE;
            }
            tracking = false;
            const stale = at - lastAt > 160;
            if (stale)
            {
                speed = 0;
            }
            const offset = clamp(last - (wanted === 'y' ? originY : originX));
            const flick = (signed ? Math.abs(speed) : speed) >= options.velocity;
            return { offset, axis: locked, dismiss: Math.abs(offset) >= options.threshold || flick };
        },

        active: () => tracking,
        axis: () => locked,
        speed: () => speed
    };
}
