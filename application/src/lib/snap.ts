export function projected(offset: number, speed: number, bias = 90): number
{
    return offset + speed * bias;
}

export function nearestIndex(value: number, points: number[]): number
{
    let best = 0;
    for (let index = 1; index < points.length; index += 1)
    {
        if (Math.abs(points[index] - value) < Math.abs(points[best] - value))
        {
            best = index;
        }
    }
    return best;
}

export function settleIndex(offset: number, speed: number, points: number[], bias = 90): number
{
    return nearestIndex(projected(offset, speed, bias), points);
}

export function detents(height: number, stops: number[]): number[]
{
    return stops.map((stop) => Math.round(height * (1 - stop)));
}

export function stepAlong(position: number, extent: number, page: number, direction: 1 | -1): number
{
    return Math.min(Math.max(0, position + direction * page), Math.max(0, extent - page));
}
