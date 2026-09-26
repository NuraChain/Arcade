/**
 * One bit the LANDING page is allowed to know: has somebody signed in on this browser.
 *
 * The header had a single answer for everybody - "Connect wallet" - including for the person who
 * was already signed in and only wanted to get back to their tables.
 *
 * Asking properly is not available here. `/` is `render: 'static'`, prerendered to a file, and it
 * deliberately holds neither `session.store.ts` nor `api.ts`: `api.ts` carries a top-level await on
 * the route manifest, so a page whose whole promise is that it paints with no JavaScript and no
 * server would open a request on every visit. `tools/budgets.mjs` fails the build if either reaches
 * that chunk, and the browser pass asserts the landing makes no api call at all. The session cookie
 * itself is HttpOnly, as it must be, so there is nothing to read.
 *
 * So the app leaves a note for the landing page instead. `session.store.ts` writes it when
 * `/auth/me` comes back with an account and clears it on sign-out - it is already "a CACHE of that
 * answer, never the source of it", and this is one bit of the same cache.
 *
 * **It authorises nothing.** `requireSession` on the server decides everything, and `lib/guards.ts`
 * checks for real on the way into `/app`. A stale note costs one redirect to `/sign-in`, which is
 * what a person with an expired session already gets. Nothing here is worth forging: it says only
 * what the reader's own screen already shows them.
 *
 * This module imports NOTHING, so the landing chunk pays four lines for it.
 */
const NOTE = 'nura.here';

/** A year: it outlives the session on purpose, because being wrong costs a redirect. */
const KEEP = 365 * 24 * 60 * 60;

export function beenHere(): boolean
{
    if (typeof document === 'undefined')
    {
        return false;
    }

    return document.cookie.split('; ').some((one) => one.startsWith(`${ NOTE }=1`));
}

export function rememberBeenHere(here: boolean): void
{
    if (typeof document === 'undefined')
    {
        return;
    }

    try
    {
        document.cookie = here
            ? `${ NOTE }=1; path=/; max-age=${ KEEP }; samesite=lax`
            : `${ NOTE }=; path=/; max-age=0; samesite=lax`;
    }
    catch
    {
        // A browser refusing cookies is a browser that sees the signed-out header. Nothing breaks.
    }
}
