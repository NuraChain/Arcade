import { NORMALS } from '../../frontend/src/game/stage/dice.ts';

const FAINT = 0.1;

const FRAME = 1000 / 60;

const STILL = 0.05;

const round = (value) => Math.round(value * 10) / 10;

export async function watch(page, options)
{
    await page.evaluate(({ name, nodes, within, stage, body, marks }) =>
    {
        window.__motion ??= {};
        cancelAnimationFrame(window.__motion[name]?.raf);

        const frames = [];
        const state = { frames, raf: 0 };
        const started = performance.now();

        const step = () =>
        {
            const frame = document.querySelector(within)?.getBoundingClientRect();
            const items = {};
            let unkeyed = 0;

            if (frame !== undefined && frame.width > 0)
            {
                for (const node of document.querySelectorAll(nodes))
                {
                    const key = node.dataset.key;

                    if (key === undefined || key === '')
                    {
                        unkeyed += 1;
                        continue;
                    }

                    const drawn = body === null ? node : node.querySelector(body) ?? node;
                    const box = drawn.getBoundingClientRect();

                    if (box.width === 0 && box.height === 0)
                    {
                        continue;
                    }

                    const opacity = Number(getComputedStyle(node).opacity);
                    const held = items[key];

                    if (held === undefined || opacity > held[3])
                    {
                        items[key] = [
                            (box.x + box.width / 2 - frame.x) / frame.width * 1000,
                            (box.y + box.height / 2 - frame.y) / frame.width * 1000,
                            box.width / frame.width * 1000,
                            opacity,
                            body === null ? '' : getComputedStyle(drawn).transform
                        ];
                    }
                }
            }

            frames.push({
                at: performance.now() - started,
                presenting: document.querySelector(stage)?.hasAttribute('data-presenting') === true,
                marks: Object.fromEntries(marks.map(([mark, selector]) => [mark, document.querySelector(selector) !== null])),
                unkeyed,
                items
            });
            state.raf = requestAnimationFrame(step);
        };

        window.__motion[name] = state;
        state.raf = requestAnimationFrame(step);
    }, {
        name: options.name ?? 'men',
        nodes: options.nodes,
        within: options.within,
        stage: options.stage ?? '.table-stage',
        body: options.body ?? null,
        marks: Object.entries(options.marks ?? {})
    });
}

export async function stopWatching(page, name = 'men')
{
    return await page.evaluate((which) =>
    {
        const state = window.__motion?.[which];

        if (state === undefined)
        {
            return [];
        }

        cancelAnimationFrame(state.raf);

        return state.frames;
    }, name);
}

export function seriesOf(frames, key)
{
    const out = [];

    frames.forEach((frame, index) =>
    {
        const item = frame.items[key];

        if (item !== undefined)
        {
            out.push({ index, at: frame.at, x: item[0], y: item[1], w: item[2], o: item[3], m: item[4] ?? '' });
        }
    });

    return out;
}

const keysOf = (frames) => [...new Set(frames.flatMap((frame) => Object.keys(frame.items)))];

export const unkeyedIn = (frames) => frames.reduce((most, frame) => Math.max(most, frame.unkeyed), 0);

const lengthOf = (route) => route.slice(1).reduce((sum, to, leg) => sum + Math.hypot(to.x - route[leg].x, to.y - route[leg].y), 0);

export function travelOf(frames, key)
{
    const seen = seriesOf(frames, key).filter((one) => one.o >= FAINT);
    const steps = [];

    for (let at = 1; at < seen.length; at += 1)
    {
        const from = seen[at - 1];
        const to = seen[at];

        steps.push({
            size: Math.hypot(to.x - from.x, to.y - from.y),
            hidden: to.index - from.index > 1,
            frames: Math.max(1, Math.round((to.at - from.at) / FRAME)),
            at: to.at
        });
    }

    return { seen, steps, moved: steps.reduce((sum, one) => sum + one.size, 0) };
}

function reach(point, from, to)
{
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const span = dx * dx + dy * dy;
    const along = span === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / span));

    return Math.hypot(point.x - (from.x + dx * along), point.y - (from.y + dy * along));
}

function missed(seen, route, within)
{
    const out = [];
    let from = 0;

    for (const [index, point] of route.entries())
    {
        let best = Infinity;
        let where = from;

        for (let at = from; at < seen.length; at += 1)
        {
            const near = at + 1 < seen.length ? reach(point, seen[at], seen[at + 1]) : Math.hypot(point.x - seen[at].x, point.y - seen[at].y);

            if (near < best)
            {
                best = near;
                where = at;
            }

            if (near <= within)
            {
                break;
            }
        }

        if (best > within)
        {
            out.push({ index, by: round(best) });
        }
        else
        {
            from = where;
        }
    }

    return out;
}

function flickered(all)
{
    let top = 0;
    let low = 1;
    let fell = false;

    for (const one of all)
    {
        if (!fell)
        {
            top = Math.max(top, one.o);

            if (one.o < top - 0.05)
            {
                fell = true;
                low = one.o;
            }
        }
        else
        {
            low = Math.min(low, one.o);

            if (one.o > low + 0.05)
            {
                return true;
            }
        }
    }

    return false;
}

const leaps = (step, bound, median, near) => step.size > (step.hidden ? Math.max(median * 3, near) : bound * step.frames);

export function judge(frames, key, route, options = {})
{
    const { seen, steps, moved } = travelOf(frames, key);
    const expected = lengthOf(route);
    const near = options.near ?? 4;
    const through = options.through ?? 12;
    const problems = [];

    if (seen.length < 2)
    {
        return { ok: false, problems: ['it was never drawn'], moved: 0, expected: round(expected), samples: seen.length };
    }

    const first = seen[0];
    const last = seen[seen.length - 1];
    const start = route[0];
    const end = route[route.length - 1];
    const sizes = steps.map((one) => one.size).filter((size) => size > STILL).sort((a, b) => a - b);
    const median = sizes.length === 0 ? 0 : sizes[Math.floor(sizes.length / 2)];
    const bound = Math.max(expected * 0.35, median * 3);

    if (Math.hypot(first.x - start.x, first.y - start.y) > near)
    {
        problems.push(`it set off ${ round(Math.hypot(first.x - start.x, first.y - start.y)) } from where it stood`);
    }

    if (Math.hypot(last.x - end.x, last.y - end.y) > near)
    {
        problems.push(`it came to rest ${ round(Math.hypot(last.x - end.x, last.y - end.y)) } from its place`);
    }

    if (Math.abs(moved - expected) > expected * 0.15)
    {
        problems.push(`it travelled ${ round(moved) } over a route of ${ round(expected) }`);
    }

    for (const one of steps)
    {
        if (leaps(one, bound, median, near))
        {
            problems.push(one.hidden
                ? `it was hidden and came back ${ round(one.size) } away`
                : `it jumped ${ round(one.size) } in one frame (the bound is ${ round(bound) })`);
            break;
        }
    }

    for (const one of missed(seen, route, through))
    {
        problems.push(`it passed ${ one.by } from point ${ one.index } of its route`);
    }

    if (flickered(seriesOf(frames, key)))
    {
        problems.push('it faded out and came back');
    }

    return {
        ok: problems.length === 0,
        problems,
        moved: round(moved),
        expected: round(expected),
        median: round(median),
        worst: round(steps.reduce((most, one) => Math.max(most, one.size / (one.hidden ? 1 : one.frames)), 0)),
        samples: seen.length
    };
}

export function smooth(frames, key)
{
    const { seen, steps, moved } = travelOf(frames, key);
    const sizes = steps.map((one) => one.size).filter((size) => size > STILL).sort((a, b) => a - b);
    const median = sizes.length === 0 ? 0 : sizes[Math.floor(sizes.length / 2)];
    const bound = Math.max(moved * 0.35, median * 3);
    const worst = steps.reduce((most, one) => Math.max(most, one.size / (one.hidden ? 1 : one.frames)), 0);

    return {
        ok: seen.length >= 2 && !steps.some((one) => leaps(one, bound, median, 4)),
        moved: round(moved),
        worst: round(worst),
        bound: round(bound),
        samples: seen.length
    };
}

export function bystanders(frames, moving, tolerance = 3)
{
    const out = [];

    for (const key of keysOf(frames))
    {
        if (moving.includes(key))
        {
            continue;
        }

        const { moved, seen } = travelOf(frames, key);
        const drawn = frames.filter((frame) => frame.items[key] !== undefined).length;

        if (moved > tolerance)
        {
            out.push(`${ key } moved ${ round(moved) }`);
        }
        else if (drawn !== frames.length || seen.length !== drawn)
        {
            out.push(`${ key } was not drawn in ${ frames.length - seen.length } of ${ frames.length } frames`);
        }
    }

    return out;
}

export function faceOf(transform)
{
    const match = /^matrix3d\((.+)\)$/.exec(transform ?? '');

    if (match === null)
    {
        return { face: null, square: 0 };
    }

    const cell = match[1].split(',').map(Number);
    const toward = [cell[2], cell[6], cell[10]];
    let face = null;
    let square = -Infinity;

    for (const [name, normal] of Object.entries(NORMALS))
    {
        const dot = normal[0] * toward[0] + normal[1] * toward[1] + normal[2] * toward[2];

        if (dot > square)
        {
            square = dot;
            face = Number(name);
        }
    }

    return { face, square: Math.round(square * 1000) / 1000 };
}

export async function diceOf(page, zone = '.bgt-dice')
{
    return await page.evaluate((chosen) => [...document.querySelectorAll(`${ chosen } > .die3d`)].map((die) => ({
        key: die.dataset.key ?? '',
        shown: Number(die.dataset.face),
        blank: die.hasAttribute('data-blank'),
        connected: die.isConnected,
        transform: getComputedStyle(die.querySelector('.die3d-body') ?? die).transform
    })), zone);
}

export async function armPress(page, target)
{
    await page.evaluate((chosen) =>
    {
        cancelAnimationFrame(window.__press?.raf);

        const state = { frame: 0, pressed: null, answered: null, raf: 0, before: new Set() };
        const scripted = () => [...document.querySelectorAll(chosen)]
            .flatMap((node) => node.getAnimations())
            .filter((one) => one.constructor.name === 'Animation' && one.playState === 'running');

        const tick = () =>
        {
            state.frame += 1;

            if (state.pressed !== null && state.answered === null && scripted().some((one) => !state.before.has(one)))
            {
                state.answered = state.frame - state.pressed;
            }

            state.raf = requestAnimationFrame(tick);
        };

        document.addEventListener('pointerup', () =>
        {
            if (state.pressed === null)
            {
                state.pressed = state.frame;
                state.before = new Set(scripted());
            }
        }, { capture: true, once: true });

        window.__press = state;
        state.raf = requestAnimationFrame(tick);
    }, target);
}

export async function pressOf(page)
{
    return await page.evaluate(() =>
    {
        const state = window.__press;

        if (state === undefined)
        {
            return { pressed: null, answered: null };
        }

        cancelAnimationFrame(state.raf);

        return { pressed: state.pressed, answered: state.answered };
    });
}

export async function watchKeyframes(page, root)
{
    await page.evaluate((chosen) =>
    {
        cancelAnimationFrame(window.__keyframes?.raf);

        const TURNING = ['transform', 'translate', 'scale', 'rotate', 'offsetDistance'];
        const BLINK = 17;
        const state = { found: {}, seen: 0, raf: 0 };

        const tick = () =>
        {
            const host = document.querySelector(chosen);

            for (const one of host === null ? [] : document.getAnimations())
            {
                const target = one.effect?.target ?? null;

                if (target === null || !host.contains(target) || one.playState !== 'running' || one.effect.getComputedTiming().activeDuration < BLINK)
                {
                    continue;
                }

                state.seen += 1;

                for (const frame of one.effect.getKeyframes())
                {
                    for (const name of TURNING)
                    {
                        if (frame[name] !== undefined && frame[name] !== 'none')
                        {
                            state.found[`${ target.className || target.tagName } ${ name }`] = String(frame[name]).slice(0, 60);
                        }
                    }
                }
            }

            state.raf = requestAnimationFrame(tick);
        };

        window.__keyframes = state;
        state.raf = requestAnimationFrame(tick);
    }, root);
}

export async function keyframesOf(page)
{
    return await page.evaluate(() =>
    {
        const state = window.__keyframes;

        if (state === undefined)
        {
            return { seen: 0, turning: [] };
        }

        cancelAnimationFrame(state.raf);

        return { seen: state.seen, turning: Object.entries(state.found).map(([what, value]) => `${ what }: ${ value }`) };
    });
}

export async function hideTab(page, hidden)
{
    await page.evaluate((away) =>
    {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (away ? 'hidden' : 'visible') });
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => away });
        document.dispatchEvent(new Event('visibilitychange'));
    }, hidden);
}
