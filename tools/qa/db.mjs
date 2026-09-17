import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ENV_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'server', '.env');

/**
 * Where the server keeps its rows, read from the server's own `DATABASE_URL`.
 *
 * The two hand-run passes each carried their own copy of the database name, and the copy drifted:
 * `server/.env` said `nuragames` while both scripts said `nura_games`, and both databases existed.
 * So every SQL assertion in `social-pass` ran against an empty database and answered 0 while the
 * product, sitting on the other one, was doing exactly what the assertion asked about. Three checks
 * reported a broken friend request, a missing friendship and an unconfirmed device, and all three
 * were the harness looking in the wrong place.
 *
 * A second copy of a connection string is the same defect `tools/preview.mjs` had with the route
 * list, and it fails the same way: silently, and in the direction that accuses the product.
 *
 * `PGDATABASE` still wins when it is set, so a run can be pointed at a scratch database on purpose.
 */
export function databaseName()
{
    if (process.env.PGDATABASE !== undefined && process.env.PGDATABASE !== '')
    {
        return process.env.PGDATABASE;
    }

    try
    {
        const line = readFileSync(ENV_FILE, 'utf8')
            .split('\n')
            .map((text) => text.trim())
            .find((text) => text.startsWith('DATABASE_URL='));

        if (line !== undefined)
        {
            const url = new URL(line.slice('DATABASE_URL='.length).replace(/^['"]|['"]$/g, ''));
            const name = url.pathname.replace(/^\//, '');
            if (name !== '')
            {
                return name;
            }
        }
    }
    catch
    {
        // An unreadable or malformed .env is not a reason to fail before the pass has started; the
        // documented name is the right guess and psql will say so plainly if it is wrong.
    }

    return 'nura_games';
}

/** Runs one statement (or several, separated by `;`) and returns stdout, trimmed. */
export function sql(text)
{
    return execFileSync(
        'psql',
        ['-U', 'postgres', '-h', '127.0.0.1', '-d', databaseName(), '-qtA', '-c', text],
        { env: { ...process.env, PGPASSWORD: process.env.PGPASSWORD ?? 'root' }, encoding: 'utf8' }
    ).trim();
}
