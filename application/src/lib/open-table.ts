import { useLocale } from '../stores/locale.store.ts';
import { useToasts } from '../stores/toasts.store.ts';

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
 * It also owns the refusal. Opening a table can fail - a rate limit, a dropped connection, a config
 * the game does not play - and eight `void`-less calls meant a rejection nobody caught. Saying so
 * once here beats nine copies of the same catch, five of which would have had to import a toast
 * store to write it.
 */
export function openTable(made: Promise<string>, go: (to: string) => void): void
{
    void made
        .then((id) => go(`/app/play/${ id }`))
        .catch(() =>
        {
            useToasts().show({
                kind: 'warning',
                text: useLocale().t('play.openFailed'),
                dedupe: 'open-table'
            });
        });
}
