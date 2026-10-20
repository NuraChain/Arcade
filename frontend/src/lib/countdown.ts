export function countdown(left: number, whole: number)
{
    return `--from: ${ (left / whole).toFixed(4) }; --left: ${ Math.round(left) }ms`;
}
