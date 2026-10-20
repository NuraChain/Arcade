import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

export function adopt(text: string, into: NodeJS.ProcessEnv)
{
    for (const [name, value] of Object.entries(parseEnv(text)))
    {
        if (name !== 'NODE_ENV' && into[name] === undefined)
        {
            into[name] = value;
        }
    }
}

const file = new URL('../.env', import.meta.url);

if (existsSync(file))
{
    adopt(readFileSync(file, 'utf8'), process.env);
}
