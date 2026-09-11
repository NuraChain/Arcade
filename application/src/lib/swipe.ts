export interface DragOptions
{
    threshold: number;
    velocity: number;
}

export interface DragFrame
{
    offset: number;
    dismiss: boolean;
}

export interface Drag
{
    start(y: number, at: number): void;
    move(y: number, at: number): DragFrame;
    end(at: number): DragFrame;
    active(): boolean;
}

export function createDrag(options: DragOptions): Drag
{
    let origin = 0;
    let last = 0;
    let lastAt = 0;
    let speed = 0;
    let tracking = false;

    return {
        start(y, at)
        {
            origin = y;
            last = y;
            lastAt = at;
            speed = 0;
            tracking = true;
        },

        move(y, at)
        {
            if (!tracking)
            {
                return { offset: 0, dismiss: false };
            }
            const elapsed = Math.max(1, at - lastAt);
            speed = (y - last) / elapsed;
            last = y;
            lastAt = at;
            return { offset: Math.max(0, y - origin), dismiss: false };
        },

        end()
        {
            if (!tracking)
            {
                return { offset: 0, dismiss: false };
            }
            tracking = false;
            const offset = Math.max(0, last - origin);
            return { offset, dismiss: offset >= options.threshold || speed >= options.velocity };
        },

        active: () => tracking
    };
}
