export interface PlayoutStats
{
    jitter: number;
    buffer: number;
    late: number;
    concealed: number;
    skipped: number;
}

export class Playout
{
    rate: number;
    frame: number;
    margin: number;
    least: number;
    start: number;
    learning: number;
    most: number;
    window: number;
    fade: number;
    cover: number;
    quiet: number;
    step: number;
    frames: Map<number, Float32Array>;
    played: number;
    arrived: number;
    delays: number[];
    offset: number;
    span: number;
    playing: boolean;
    position: number;
    speed: number;
    hiding: number;
    hideLength: number;
    audible: boolean;
    blend: number;
    rising: number;
    loop: Float32Array;
    history: Float32Array;
    written: number;
    cachedIndex: number;
    cachedFrame: Float32Array | undefined;
    late: number;
    concealed: number;
    skipped: number;

    constructor(rate: number, frameMs: number)
    {
        this.rate = rate;
        this.frame = Math.round(rate * frameMs / 1000);
        this.margin = Math.round(rate * 0.012);
        this.least = Math.round(rate * 0.02);
        this.start = Math.round(rate * 0.12);
        this.learning = 100;
        this.most = Math.round(rate * 0.6);
        this.window = 400;
        this.fade = Math.round(rate * 0.0025);
        this.cover = Math.round(rate * 0.06);
        this.quiet = 0.004;
        this.step = Math.round(rate * 0.01);
        this.frames = new Map();
        this.played = -1;
        this.arrived = -Infinity;
        this.delays = [];
        this.offset = 0;
        this.span = 0;
        this.playing = false;
        this.position = 0;
        this.speed = 1;
        this.hiding = -1;
        this.hideLength = this.cover;
        this.audible = false;
        this.blend = 0;
        this.rising = 0;
        this.loop = new Float32Array(this.step);
        this.history = new Float32Array(this.step * 2);
        this.written = 0;
        this.cachedIndex = -1;
        this.cachedFrame = undefined;
        this.late = 0;
        this.concealed = 0;
        this.skipped = 0;
    }

    take(index: number, samples: Float32Array, now: number)
    {
        if (index < this.played)
        {
            this.late += 1;
            return;
        }

        if (this.delays.length > 0 && now - this.offset > index * this.frame)
        {
            this.late += 1;
        }

        const whole = new Float32Array(this.frame);

        whole.set(samples.length > this.frame ? samples.subarray(0, this.frame) : samples);
        this.frames.set(index, whole);

        const burst = now - this.arrived < this.frame / 4;

        this.arrived = now;

        if (burst)
        {
            return;
        }

        this.delays.push(now - index * this.frame);

        if (this.delays.length > this.window)
        {
            this.delays.shift();
        }

        const recent = this.delays.slice(-20);
        const floor = Math.min(...this.delays);

        if (recent.length === 20 && this.delays.length > 20 && Math.min(...recent) > floor + this.rate * 0.4)
        {
            this.delays = recent;
        }

        const sorted = [...this.delays].sort((a, b) => a - b);
        const lowest = sorted[0];

        const known = Math.min(1, sorted.length / this.learning);
        const guard = Math.round(this.least + (this.start - this.least) * (1 - known));

        this.span = sorted[Math.floor(0.99 * (sorted.length - 1))] - lowest;
        this.offset = lowest + Math.min(this.most, Math.max(guard, Math.round(this.span * 1.1) + this.margin));

        if (this.frames.size > 96)
        {
            this.frames.delete(this.next());
        }
    }

    next()
    {
        let found = -1;

        for (const index of this.frames.keys())
        {
            if (found === -1 || index < found)
            {
                found = index;
            }
        }

        return found;
    }

    after(index: number)
    {
        let found = -1;

        for (const one of this.frames.keys())
        {
            if (one > index && (found === -1 || one < found))
            {
                found = one;
            }
        }

        return found;
    }

    prune(below: number)
    {
        for (const index of [...this.frames.keys()])
        {
            if (index < below)
            {
                this.frames.delete(index);
            }
        }

        this.cachedIndex = -1;
        this.cachedFrame = undefined;
    }

    sample(at: number, otherwise: number)
    {
        const index = Math.floor(at / this.frame);

        if (index !== this.cachedIndex)
        {
            this.cachedIndex = index;
            this.cachedFrame = this.frames.get(index);
        }

        const frame = this.cachedFrame;

        return frame === undefined ? otherwise : frame[at - index * this.frame];
    }

    read(at: number)
    {
        const whole = Math.floor(at);
        const t = at - whole;
        const p1 = this.sample(whole, 0);

        if (t === 0)
        {
            return p1;
        }

        const p0 = this.sample(whole - 1, p1);
        const p2 = this.sample(whole + 1, p1);
        const p3 = this.sample(whole + 2, p2);

        return p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
    }

    quietAhead(from: number)
    {
        const start = Math.floor(from);
        let sum = 0;

        for (let at = start; at < start + this.step; at += 1)
        {
            if (!this.frames.has(Math.floor(at / this.frame)))
            {
                return false;
            }

            const value = this.sample(at, 0);

            sum += value * value;
        }

        return Math.sqrt(sum / this.step) < this.quiet;
    }

    remember(value: number)
    {
        this.history[this.written % this.history.length] = value;
        this.written += 1;
    }

    hide(fast: boolean)
    {
        if (this.hiding === -1)
        {
            const length = this.loop.length;

            let sum = 0;

            for (let at = 0; at < length; at += 1)
            {
                this.loop[at] = this.history[(this.written - length + at + this.history.length * 4) % this.history.length];
                sum += this.loop[at] * this.loop[at];
            }

            this.audible = Math.sqrt(sum / length) >= this.quiet;
            this.hiding = 0;
            this.hideLength = fast ? this.fade * 2 : this.cover;
        }
    }

    hidden()
    {
        if (this.hiding === -1)
        {
            return 0;
        }

        const n = this.hiding;

        if (n >= this.hideLength)
        {
            this.hiding = -1;
            return 0;
        }

        const length = this.loop.length;
        const turn = Math.floor(n / length);
        const within = n % length;
        const fast = this.hideLength < this.cover;
        const gain = fast ? 1 - n / this.hideLength : Math.exp(-n / (this.rate * 0.02)) * (1 - n / this.hideLength);
        const value = this.loop[turn % 2 === 0 ? length - 1 - within : within] * gain;

        this.hiding += 1;

        if (!fast && this.audible)
        {
            this.concealed += 1;
        }

        return value;
    }

    steer(ideal: number)
    {
        const error = ideal - this.position;
        const band = this.rate * 0.015;

        if (error > this.rate)
        {
            this.hide(false);
            this.blend = this.fade;
            this.position = ideal;
            this.played = Math.floor(ideal / this.frame);
            this.prune(this.played);
            this.speed = 1;
            return;
        }

        if (error > this.rate * 0.08 && this.quietAhead(this.position))
        {
            this.position += this.step;
            this.skipped += this.step;
        }

        this.speed = error > band
            ? 1 + Math.min(0.03, (error - band) / (this.rate * 2))
            : (error < -band ? 1 + Math.max(-0.02, (error + band) / (this.rate * 2)) : 1);
    }

    fill(out: Float32Array, now: number)
    {
        if (this.playing)
        {
            this.steer(now - this.offset);
        }

        for (let i = 0; i < out.length; i += 1)
        {
            if (!this.playing)
            {
                const first = this.next();

                if (first === -1 || now + i - this.offset < first * this.frame)
                {
                    out[i] = this.hidden();
                    this.remember(out[i]);
                    continue;
                }

                this.playing = true;
                this.position = first * this.frame;
                this.played = first;
                this.speed = 1;

                if (this.hiding === -1)
                {
                    this.rising = this.fade;
                }
                else
                {
                    this.blend = this.fade;
                }
            }

            const index = Math.floor(this.position / this.frame);

            if (!this.frames.has(index))
            {
                const later = this.after(index);

                if (later !== -1 && later - index <= 2)
                {
                    this.hide(false);
                    out[i] = this.hidden();
                    this.position += this.speed;
                }
                else
                {
                    this.hide(later !== -1);
                    this.playing = false;
                    this.prune(index);
                    out[i] = this.hidden();
                }

                this.remember(out[i]);
                continue;
            }

            if (index > this.played)
            {
                this.played = index;
                this.prune(index - 1);
            }

            let value = this.read(this.position);

            if (this.hiding !== -1 && this.blend === 0)
            {
                this.blend = this.fade;
            }

            if (this.blend > 0)
            {
                const mix = this.blend / (this.fade + 1);

                value = value * (1 - mix) + this.hidden() * mix;
                this.blend -= 1;

                if (this.blend === 0)
                {
                    this.hiding = -1;
                }
            }
            else if (this.rising > 0)
            {
                value *= 1 - this.rising / (this.fade + 1);
                this.rising -= 1;
            }

            out[i] = value;
            this.remember(value);
            this.position += this.speed;
        }
    }

    stats(): PlayoutStats
    {
        const lowest = this.delays.length === 0 ? 0 : Math.min(...this.delays);

        return {
            jitter: Math.round(this.span * 1000 / this.rate),
            buffer: Math.round((this.offset - lowest) * 1000 / this.rate),
            late: this.late,
            concealed: Math.round(this.concealed * 1000 / this.rate),
            skipped: Math.round(this.skipped * 1000 / this.rate)
        };
    }
}
