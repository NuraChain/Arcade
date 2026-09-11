import { createStore, createSignal, type Getter } from 'azerothjs';

export interface ConnectApi
{
    open: Getter<boolean>;
    show(): void;
    close(): void;
    reset(): void;
}

/**
 * Whether the wallet chooser is open. That is the whole store, and the smallness is the point.
 *
 * The header lives in the public shell and the two call-to-action buttons live inside the landing
 * page, so something has to sit above both. It must also import NOTHING that reaches
 * `application/src/api.ts`: this module is in the landing chunk, `api.ts` has a top-level await
 * that fetches the route manifest, and the landing is prerendered precisely so that it paints
 * with no JavaScript and no server. The dialog itself - which does need the wallet, the typed
 * client and a QR encoder - is a dynamic import behind `show()`.
 */
export const useConnect = createStore((): ConnectApi =>
{
    const [open, setOpen] = createSignal(false);

    return {
        open,
        show: () => setOpen(true),
        close: () => setOpen(false),
        reset: () => setOpen(false)
    };
});
