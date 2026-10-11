import { inOutCubic, inOutQuad, parabola, steps, type Curve } from './curves.ts';

export interface Point
{
    x: number;
    y: number;
}

export interface Step
{
    at: number;
    x: number;
    y: number;
    lift: number;
    progress: number;
}

export interface Arc
{
    duration: number;
    arch: number;
    ease?: Curve;
}

export interface Walk
{
    hops: readonly number[];
    lifts: readonly number[];
    ease?: Curve;
}

export interface Walked
{
    length: number;
    steps: Step[];
    lands: number[];
}

export function arc(from: Point, to: Point, shape: Arc)
{
    const ease = shape.ease ?? inOutCubic;
    const count = steps(shape.duration);
    const out: Step[] = [];

    for (let index = 0; index <= count; index += 1)
    {
        const time = index / count;
        const progress = ease(time);

        out.push({
            at: time * shape.duration,
            x: from.x + (to.x - from.x) * progress,
            y: from.y + (to.y - from.y) * progress,
            lift: shape.arch * parabola(time),
            progress
        });
    }

    return out;
}

export function walk(route: readonly Point[], shape: Walk): Walked
{
    const ease = shape.ease ?? inOutQuad;
    const legs = Math.max(0, route.length - 1);
    const out: Step[] = route.length === 0 ? [] : [{ at: 0, x: route[0].x, y: route[0].y, lift: 0, progress: 0 }];
    const lands: number[] = [];
    let start = 0;

    for (let leg = 0; leg < legs; leg += 1)
    {
        const from = route[leg];
        const to = route[leg + 1];
        const length = Math.max(0, shape.hops[leg] ?? 0);
        const lift = shape.lifts[leg] ?? 0;
        const count = steps(length);

        for (let index = 1; index <= count; index += 1)
        {
            const time = index / count;
            const share = ease(time);

            out.push({
                at: start + time * length,
                x: index === count ? to.x : from.x + (to.x - from.x) * share,
                y: index === count ? to.y : from.y + (to.y - from.y) * share,
                lift: index === count ? 0 : lift * parabola(time),
                progress: (leg + time) / legs
            });
        }

        start += length;
        lands.push(start);
    }

    return { length: start, steps: out, lands };
}
