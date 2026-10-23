export interface PgnGame
{
    site: string;
    date: Date;
    white: string;
    black: string;
    result: '1-0' | '0-1' | '1/2-1/2' | '*';
    clock?: { base: number; increment: number };
    notation: readonly string[];
}

const LINE = 79;

const pad = (value: number) => String(value).padStart(2, '0');

const quoted = (value: string) => `"${ value.replace(/\\/g, '\\\\').replace(/"/g, '\\"') }"`;

/** The moves paired by number, White's first, as a move list and a PGN read them. */
export function pairsOf(notation: readonly string[])
{
    return Array.from({ length: Math.ceil(notation.length / 2) }, (_, at) => ({
        n: at + 1,
        white: notation[at * 2],
        black: notation[at * 2 + 1] ?? null
    }));
}

/** A finished or running game in the PGN export format: the seven tags, its time control, and its moves wrapped under eighty columns. */
export function pgnOf(game: PgnGame)
{
    const date = `${ game.date.getUTCFullYear() }.${ pad(game.date.getUTCMonth() + 1) }.${ pad(game.date.getUTCDate()) }`;
    const tags = [
        ['Event', 'Baziche'],
        ['Site', game.site],
        ['Date', date],
        ['Round', '-'],
        ['White', game.white],
        ['Black', game.black],
        ['Result', game.result],
        ...(game.clock === undefined ? [] : [['TimeControl', game.clock.increment === 0 ? `${ game.clock.base / 1000 }` : `${ game.clock.base / 1000 }+${ game.clock.increment / 1000 }`]])
    ].map(([name, value]) => `[${ name } ${ quoted(value) }]`);
    const tokens = [...pairsOf(game.notation).flatMap((pair) => [`${ pair.n }. ${ pair.white }`, ...(pair.black === null ? [] : [pair.black])]), game.result];
    const lines: string[] = [];
    let line = '';

    for (const token of tokens)
    {
        if (line !== '' && line.length + 1 + token.length > LINE)
        {
            lines.push(line);
            line = token;
        }
        else
        {
            line = line === '' ? token : `${ line } ${ token }`;
        }
    }

    lines.push(line);

    return `${ tags.join('\n') }\n\n${ lines.join('\n') }\n`;
}
