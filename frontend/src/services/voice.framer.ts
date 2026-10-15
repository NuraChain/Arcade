export class Framer
{
    size: number;
    held: Float32Array;
    at: number;

    constructor(size: number)
    {
        this.size = size;
        this.held = new Float32Array(size);
        this.at = 0;
    }

    push(channel: Float32Array | undefined, length: number)
    {
        const done: Float32Array[] = [];

        for (let index = 0; index < length; index += 1)
        {
            this.held[this.at] = channel === undefined ? 0 : channel[index];
            this.at += 1;

            if (this.at === this.size)
            {
                done.push(this.held);
                this.held = new Float32Array(this.size);
                this.at = 0;
            }
        }

        return done;
    }
}
