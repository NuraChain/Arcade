import { ApiError, type MatchView } from '../api.ts';
import { inPlay } from '../data/match.ts';
import type { MessageKey } from '../locales/en.ts';
import { useLocale } from '../stores/locale.store.ts';
import { useToasts } from '../stores/toasts.store.ts';
import { isTableRefusal } from '../../../backend/src/domains/table/refusals.ts';

/**
 * Goes to a table, once there is a table to go to.
 *
 * `lobby.quick` and `lobby.host` both answer with a PROMISE of a table id, because opening one is a
 * round trip - the server claims a chair at an existing table or inserts a new one. Eight call sites
 * put that promise straight into the url:
 *
 *     navigate(`/app/play/${ lobby.quick(game) }`)
 *
 * which is perfectly legal TypeScript - a template literal will happily call `toString` on anything -
 * and sends every Play button in the product to `/app/play/[object%20Promise]`. Every gate passed:
 * `npm run qa` tours routes by url and never presses a button, and no spec rendered one.
 *
 * Taking the promise as an argument is what makes the broken version impossible to write here: the
 * id cannot be interpolated before it exists, because the caller never holds the id at all.
 *
 * `settled` runs whichever way it ended, and a caller with a spinner needs it. Without one the
 * sheet that opens a table set `pending` and only ever cleared it by closing on success - so a
 * refusal left the primary button spinning for ever, on a sheet that was still open, over a form
 * that could simply have been corrected and sent again.
 *
 * It also owns the refusal. Opening a table can fail - a rate limit, a dropped connection, a config
 * the game does not play - and eight `void`-less calls meant a rejection nobody caught. Saying so
 * once here beats nine copies of the same catch, five of which would have had to import a toast
 * store to write it.
 */
export function whyRefused(error: unknown, otherwise: MessageKey, playing: MessageKey = otherwise): MessageKey
{
    const word = error instanceof ApiError && isTableRefusal(error.code) ? error.code : null;

    if (word === null)
    {
        return otherwise;
    }

    if (word === 'seated-max')
    {
        return 'play.seatedMax';
    }

    return word === 'playing' ? playing : `tables.refused.${ word }`;
}

export function leaveLead(live: Pick<MatchView, 'finishedAt' | 'mine' | 'players' | 'view'> | null, taken: number)
{
    if (live !== null && live.finishedAt === undefined)
    {
        return inPlay(live) ? 'play.leave.forfeit' : 'play.leave.locked';
    }

    return taken <= 1 ? 'play.leave.last' : 'play.leave.lead';
}

const ABOUT_THE_ASK: readonly MessageKey[] = ['play.seatedMax', 'tables.refused.no-invitee', 'tables.refused.quick-game', 'tables.refused.quick-options'];

export function openTable(made: Promise<string>, go: (to: string) => void, settled?: () => void)
{
    void made
        .then((id) => go(`/app/play/${ id }`))
        .catch((error: unknown) =>
        {
            const why = whyRefused(error, 'play.openFailed');

            useToasts().show({
                kind: 'warning',
                text: useLocale().t(ABOUT_THE_ASK.includes(why) ? why : 'play.openFailed'),
                dedupe: 'open-table'
            });
        })
        .finally(() => settled?.());
}
