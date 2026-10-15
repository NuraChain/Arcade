export interface GateReading
{
    level: number;
    open: boolean;
    threshold: number;
}

export class Gate
{
    rate: number;
    ahead: Float32Array;
    written: number;
    hold: number;
    attack: number;
    release: number;
    rise: number;
    holding: number;
    gain: number;
    peak: number;
    decay: number;
    level: number;
    floor: number;
    opened: boolean;
    push: boolean;
    pressed: boolean;
    lingering: number;
    linger: number;
    auto: boolean;
    manual: number;

    constructor(rate: number)
    {
        this.rate = rate;
        this.ahead = new Float32Array(Math.round(rate * 0.01));
        this.written = 0;
        this.hold = Math.round(rate * 0.3);
        this.attack = Math.round(rate * 0.005);
        this.release = Math.round(rate * 0.08);
        this.rise = 3 / rate;
        this.holding = 0;
        this.gain = 0;
        this.peak = 0;
        this.decay = Math.exp(-1 / (rate * 0.05));
        this.level = -100;
        this.floor = -60;
        this.opened = false;
        this.push = false;
        this.pressed = false;
        this.lingering = 0;
        this.linger = 0;
        this.auto = true;
        this.manual = -50;
    }

    set(push: boolean, pressed: boolean, linger: number, auto: boolean, manual: number)
    {
        if (this.pressed && !pressed)
        {
            this.lingering = Math.round(this.rate * linger / 1000);
        }

        this.push = push;
        this.pressed = pressed;
        this.linger = linger;
        this.auto = auto;
        this.manual = manual;
    }

    threshold()
    {
        return this.auto ? Math.min(-30, Math.max(-70, this.floor + 12)) : this.manual;
    }

    process(input: Float32Array, output: Float32Array)
    {
        let sum = 0;

        for (let i = 0; i < input.length; i += 1)
        {
            sum += input[i] * input[i];
        }

        const rms = Math.sqrt(sum / Math.max(1, input.length));

        this.peak = Math.max(rms, this.peak * Math.pow(this.decay, input.length));
        this.level = 20 * Math.log10(Math.max(this.peak, 1e-5));

        if (this.level < this.floor)
        {
            this.floor += (this.level - this.floor) * 0.25;
        }
        else
        {
            this.floor += this.rise * input.length;
        }

        const threshold = this.threshold();

        if (this.push)
        {
            if (this.pressed)
            {
                this.opened = true;
            }
            else if (this.lingering > 0)
            {
                this.lingering -= input.length;
            }
            else
            {
                this.opened = false;
            }
        }
        else if (this.level > threshold)
        {
            this.opened = true;
            this.holding = this.hold;
        }
        else if (this.level < threshold - 4)
        {
            this.holding -= input.length;

            if (this.holding <= 0)
            {
                this.opened = false;
            }
        }

        const length = this.ahead.length;

        for (let i = 0; i < input.length; i += 1)
        {
            const slot = this.written % length;
            const late = this.ahead[slot];

            this.ahead[slot] = input[i];
            this.written += 1;

            if (this.opened)
            {
                this.gain = Math.min(1, this.gain + 1 / this.attack);
            }
            else
            {
                this.gain = Math.max(0, this.gain - 1 / this.release);
            }

            output[i] = late * this.gain;
        }
    }

    reading(): GateReading
    {
        return { level: Math.round(this.level * 10) / 10, open: this.opened, threshold: Math.round(this.threshold() * 10) / 10 };
    }
}
