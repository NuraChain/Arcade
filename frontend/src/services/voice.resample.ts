export interface Resampler
{
    push(input: Float32Array): Float32Array<ArrayBuffer>;
}

const PHASES = 256;

const HALF = 16;

const TAPS = HALF * 2;

const PASS = 0.92;

const blackman = (x: number) =>
{
    const at = (x + HALF) / (2 * HALF);

    return at <= 0 || at >= 1 ? 0 : 0.42 - 0.5 * Math.cos(2 * Math.PI * at) + 0.08 * Math.cos(4 * Math.PI * at);
};

const sinc = (x: number) => (x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x));

function kernel(cutoff: number)
{
    const table = new Float32Array(PHASES * TAPS);

    for (let phase = 0; phase < PHASES; phase += 1)
    {
        const shift = phase / PHASES;
        let sum = 0;

        for (let tap = 0; tap < TAPS; tap += 1)
        {
            const x = tap - HALF + 1 - shift;
            const value = cutoff * sinc(cutoff * x) * blackman(x);

            table[phase * TAPS + tap] = value;
            sum += value;
        }

        for (let tap = 0; tap < TAPS; tap += 1)
        {
            table[phase * TAPS + tap] /= sum;
        }
    }

    return table;
}

export function createResampler(from: number, to: number): Resampler
{
    if (from === to)
    {
        return { push: (input) => input.slice() };
    }

    const step = from / to;
    const table = kernel(Math.min(1, to / from) * PASS);
    let held = new Float32Array(TAPS);
    let at = HALF;

    return {
        push(input)
        {
            const buffer = new Float32Array(held.length + input.length);

            buffer.set(held);
            buffer.set(input, held.length);

            const out: number[] = [];

            while (Math.floor(at) + HALF + 1 < buffer.length)
            {
                const near = Math.round((at - Math.floor(at)) * PHASES);
                const whole = Math.floor(at) + (near === PHASES ? 1 : 0);
                const row = (near === PHASES ? 0 : near) * TAPS;
                const first = whole - HALF + 1;
                let sum = 0;

                for (let tap = 0; tap < TAPS; tap += 1)
                {
                    sum += buffer[first + tap] * table[row + tap];
                }

                out.push(sum);
                at += step;
            }

            const keep = Math.min(buffer.length, TAPS);

            held = buffer.slice(buffer.length - keep);
            at -= buffer.length - keep;

            return Float32Array.from(out);
        }
    };
}
