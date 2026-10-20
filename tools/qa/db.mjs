import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ENV_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '.env');

/**
 * Where the server keeps its rows, read from the server's own `DATABASE_URL`.
 *
 * The two hand-run passes each carried their own copy of the database name, and the copy drifted:
 * the server's `.env` said `nuragames` while both scripts said `nura_games`, and both databases existed.
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

    const name = databaseUrl()?.pathname.replace(/^\//, '') ?? '';

    return name === '' ? 'nura_games' : name;
}

/**
 * The server's own `DATABASE_URL`, or null when the root `.env` cannot be read or names none.
 *
 * An unreadable or malformed .env is not a reason to fail before the pass has started: the documented
 * name is the right guess and psql will say so plainly if it is wrong. The account, the host, the port
 * and the password come from here too. A password written into this file is a password published with
 * the repository, and one that matches nobody's database but the machine it was written on.
 */
function databaseUrl()
{
    try
    {
        const line = readFileSync(ENV_FILE, 'utf8')
            .split('\n')
            .map((text) => text.trim())
            .find((text) => text.startsWith('DATABASE_URL='));

        return line === undefined ? null : new URL(line.slice('DATABASE_URL='.length).replace(/^['"]|['"]$/g, ''));
    }
    catch
    {
        return null;
    }
}

/** Runs one statement (or several, separated by `;`) and returns stdout, trimmed. */
export function sql(text)
{
    const url = databaseUrl();
    const password = process.env.PGPASSWORD ?? (url === null || url.password === '' ? undefined : decodeURIComponent(url.password));

    return execFileSync(
        'psql',
        [
            '-U', url === null || url.username === '' ? 'postgres' : decodeURIComponent(url.username),
            '-h', url === null || url.hostname === '' ? '127.0.0.1' : url.hostname,
            '-p', url === null || url.port === '' ? '5432' : url.port,
            '-d', databaseName(), '-qtA', '-c', text
        ],
        { env: password === undefined ? process.env : { ...process.env, PGPASSWORD: password }, encoding: 'utf8' }
    ).trim();
}
