import { useLocale } from '../stores/locale.store.ts';
import { useToasts, type ToastKind } from '../stores/toasts.store.ts';

export interface Done
{
    text: string;
    kind?: ToastKind;
}

export async function attempt(work: Promise<unknown>, done?: Done | string): Promise<boolean>
{
    try
    {
        await work;

        if (done !== undefined)
        {
            const said = typeof done === 'string' ? { text: done } : done;
            useToasts().show({ kind: said.kind ?? 'success', text: said.text });
        }

        return true;
    }
    catch (error)
    {
        console.error('[attempt]', error);
        useToasts().show({ kind: 'warning', text: useLocale().t('common.actionFailed'), dedupe: 'attempt' });
        return false;
    }
}
