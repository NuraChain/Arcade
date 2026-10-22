import { createEffect, createRoot, untrack } from 'azerothjs';

import type { SiteNotice } from '../../api.ts';
import { runtime } from '../../lib/runtime.ts';
import { useCatalogue } from '../../stores/catalogue.store.ts';
import { useLobby } from '../../stores/lobby.store.ts';
import { useLocale } from '../../stores/locale.store.ts';
import { useSettings } from '../../stores/settings.store.ts';
import { useToasts } from '../../stores/toasts.store.ts';

export const standing = (notice: SiteNotice | null, seen: string, now: number) =>
    notice !== null && notice.id !== seen && Date.parse(notice.until) > now;

export function sayAtTable()
{
    const catalogue = useCatalogue();
    const lobby = useLobby();
    const locale = useLocale();
    const settings = useSettings();
    const toasts = useToasts();
    const said = new Set<string>();

    return createRoot((dispose) =>
    {
        createEffect(() =>
        {
            const notice = catalogue.notice();
            const table = lobby.openId();
            const seen = settings.settings().noticeSeen;

            if (notice === null || table === '' || said.has(notice.id) || !standing(notice, seen, runtime().clock.now()))
            {
                return;
            }

            said.add(notice.id);
            untrack(() => toasts.show({
                kind: 'info',
                icon: 'megaphone',
                text: locale.text(notice),
                dedupe: `notice:${ notice.id }`,
                action: { label: locale.t('notice.gotIt'), run: () => settings.update({ noticeSeen: notice.id }) }
            }));
        });

        return dispose;
    });
}
