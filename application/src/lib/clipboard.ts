import type { MessageKey } from '../locales/en.ts';
import { useLocale } from '../stores/locale.store.ts';
import { useToasts } from '../stores/toasts.store.ts';

export async function copyText(value: string, done: MessageKey, options: { secret?: boolean; dedupe?: string } = {}): Promise<boolean>
{
    const toasts = useToasts();
    const locale = useLocale();
    const dedupe = options.dedupe ?? 'copy';

    try
    {
        if (navigator.clipboard === undefined)
        {
            throw new Error('no clipboard');
        }

        await navigator.clipboard.writeText(value);
        toasts.show({ kind: 'success', text: locale.t(done), dedupe });
        return true;
    }
    catch
    {
        toasts.show({
            kind: 'warning',
            text: locale.t('common.copyFailed'),
            ...(options.secret === true ? {} : { detail: value }),
            dedupe
        });
        return false;
    }
}
