import { createSignal, createStore, type Getter } from 'azerothjs';

import type { Align } from '../lib/anchor.ts';

export interface EmojiPop
{
    anchor: HTMLElement;
    pick: (emoji: string) => void;
    side: 'top' | 'bottom';
    align: Align;
    keep: boolean;
}

export interface EmojiPopApi
{
    current: Getter<EmojiPop | null>;
    toggle(pop: EmojiPop): void;
    close(): void;
}

export const useEmojiPop = createStore((): EmojiPopApi =>
{
    const [current, setCurrent] = createSignal<EmojiPop | null>(null);

    return {
        current,
        toggle: (pop) => setCurrent((now) => (now?.anchor === pop.anchor ? null : pop)),
        close: () => setCurrent(null)
    };
});
