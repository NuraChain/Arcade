import { describe, expect, it } from 'vitest';
import { createEffect, createRoot } from 'azerothjs';

import { createGuesses } from '../src/lib/guess.ts';

interface Chair
{
    who: string;
    ready: boolean;
    presses: number;
}

const HELD: Chair = { who: 'dana.w', ready: false, presses: 0 };

const ready = (chair: Chair): Chair => ({ ...chair, ready: true });

const unready = (chair: Chair): Chair => ({ ...chair, ready: false });

const pressed = (chair: Chair): Chair => ({ ...chair, presses: chair.presses + 1 });

function gate<R>()
{
    let open: (value: R) => void = () => undefined;
    let shut: (error: unknown) => void = () => undefined;
    let asked = 0;

    const waiting = new Promise<R>((resolve, reject) =>
    {
        open = resolve;
        shut = reject;
    });

    const ask = () =>
    {
        asked += 1;
        return waiting;
    };

    return { ask, open, shut, asked: () => asked };
}

async function settle()
{
    for (let turn = 0; turn < 12; turn += 1)
    {
        await Promise.resolve();
    }
}

describe('something shown before the server has said so', () =>
{
    it('is the thing itself while nothing has been guessed', () =>
    {
        const guesses = createGuesses<Chair>();

        expect(guesses.over(HELD)).toBe(HELD);
        expect(guesses.standing()).toBe(false);
    });

    it('shows in the same turn as the press, with the request already on its way', () =>
    {
        const guesses = createGuesses<Chair>();
        const send = gate<string>();
        const read = gate<void>();

        void guesses.during(ready, send.ask, read.ask);

        expect(guesses.over(HELD).ready).toBe(true);
        expect(guesses.standing()).toBe(true);
        expect(send.asked()).toBe(1);
        expect(read.asked()).toBe(0);
    });

    it('tells whoever is reading, when it is made and when it goes', async () =>
    {
        const guesses = createGuesses<Chair>();
        const send = gate<string>();
        const read = gate<void>();
        const seen: boolean[] = [];

        const stop = createRoot((dispose) =>
        {
            createEffect(() =>
            {
                seen.push(guesses.over(HELD).ready);
            });
            return dispose;
        });

        await settle();
        const asked = guesses.during(ready, send.ask, read.ask);
        await settle();
        expect(seen).toEqual([false, true]);

        send.open('done');
        read.open();
        await asked;
        await settle();
        expect(seen).toEqual([false, true, false]);

        stop();
    });

    it('stays through the answer, until the truth has been read again', async () =>
    {
        const guesses = createGuesses<Chair>();
        const send = gate<string>();
        const read = gate<void>();

        const asked = guesses.during(ready, send.ask, read.ask);

        send.open('done');
        await settle();
        expect(read.asked()).toBe(1);
        expect(guesses.over(HELD).ready).toBe(true);

        read.open();
        await expect(asked).resolves.toBe('done');
        expect(guesses.over(HELD)).toBe(HELD);
        expect(guesses.standing()).toBe(false);
    });

    it('is put back the moment the request is refused, and the refusal is the caller\'s to say', async () =>
    {
        const guesses = createGuesses<Chair>();
        const send = gate<string>();
        const read = gate<void>();
        const refusal = new Error('not-ready');

        const asked = guesses.during(ready, send.ask, read.ask);

        send.shut(refusal);
        await expect(asked).rejects.toBe(refusal);
        expect(guesses.over(HELD)).toBe(HELD);
        expect(read.asked()).toBe(0);
    });

    it('is put back when the request could not even be made', async () =>
    {
        const guesses = createGuesses<Chair>();
        const read = gate<void>();
        const broken = new Error('no client');

        const asked = guesses.during<string>(ready, () =>
        {
            throw broken;
        }, read.ask);

        await expect(asked).rejects.toBe(broken);
        expect(guesses.standing()).toBe(false);
    });

    it('is kept when the request went through and the truth could not be read, until a read lands', async () =>
    {
        const guesses = createGuesses<Chair>();
        const send = gate<string>();
        const read = gate<void>();

        const asked = guesses.during(ready, send.ask, read.ask);

        send.open('done');
        read.shut(new Error('offline'));
        await expect(asked).resolves.toBe('done');
        expect(guesses.over(HELD).ready).toBe(true);

        guesses.landed();
        expect(guesses.over(HELD)).toBe(HELD);
    });

    it('is not taken for answered by a read that lands while its request is still out', async () =>
    {
        const guesses = createGuesses<Chair>();
        const send = gate<string>();
        const read = gate<void>();

        void guesses.during(ready, send.ask, read.ask);
        guesses.landed();
        expect(guesses.over(HELD).ready).toBe(true);

        send.open('done');
        await settle();
        guesses.landed();
        expect(guesses.over(HELD).ready).toBe(true);
    });

    it('stacks in the order pressed, and each one goes by itself', async () =>
    {
        const guesses = createGuesses<Chair>();
        const first = { send: gate<string>(), read: gate<void>() };
        const second = { send: gate<string>(), read: gate<void>() };

        const one = guesses.during((chair) => pressed(ready(chair)), first.send.ask, first.read.ask);
        const two = guesses.during((chair) => pressed(unready(chair)), second.send.ask, second.read.ask);

        expect(guesses.over(HELD)).toEqual({ who: 'dana.w', ready: false, presses: 2 });

        first.send.open('one');
        first.read.open();
        await one;
        expect(guesses.over({ ...HELD, ready: true })).toEqual({ who: 'dana.w', ready: false, presses: 1 });
        expect(guesses.standing()).toBe(true);

        second.send.open('two');
        second.read.open();
        await two;
        expect(guesses.standing()).toBe(false);
    });

    it('keeps a later press when an earlier one is refused', async () =>
    {
        const guesses = createGuesses<Chair>();
        const first = { send: gate<string>(), read: gate<void>() };
        const second = { send: gate<string>(), read: gate<void>() };

        const one = guesses.during(ready, first.send.ask, first.read.ask);

        void guesses.during(pressed, second.send.ask, second.read.ask);
        first.send.shut(new Error('refused'));
        await expect(one).rejects.toThrow('refused');

        expect(guesses.over(HELD)).toEqual({ who: 'dana.w', ready: false, presses: 1 });
    });

    it('is forgotten on a reset, and a request that ends afterwards changes nothing', async () =>
    {
        const guesses = createGuesses<Chair>();
        const send = gate<string>();
        const read = gate<void>();

        const asked = guesses.during(ready, send.ask, read.ask);

        guesses.clear();
        expect(guesses.over(HELD)).toBe(HELD);

        send.open('done');
        read.shut(new Error('offline'));
        await expect(asked).resolves.toBe('done');
        expect(guesses.standing()).toBe(false);
    });

    it('says nothing to its readers when nothing changed', async () =>
    {
        const guesses = createGuesses<Chair>();
        let runs = 0;

        const stop = createRoot((dispose) =>
        {
            createEffect(() =>
            {
                guesses.over(HELD);
                runs += 1;
            });
            return dispose;
        });

        await settle();
        guesses.landed();
        guesses.clear();
        await settle();
        expect(runs).toBe(1);

        stop();
    });
});
