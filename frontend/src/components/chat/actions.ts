import type { Message } from '../../data/chat.ts';
import type { IconName } from '../../icons/registry.ts';
import { copyText } from '../../lib/clipboard.ts';
import type { MessageKey } from '../../locales/en.ts';

/** One thing a menu or a sheet offers to do with a line or a conversation. */
export interface ChatAction
{
    id: string;
    icon: IconName;
    label: string;
    danger?: boolean;
    run: () => void;
}

/** What can be done with a line, beside the reactions; a sheet and a menu draw the same list. */
export interface LineHandlers
{
    onReply?: () => void;
    onForward?: () => void;
    onDelete?: () => void;
    onPerson?: () => void;
}

/** The actions on a line in the order every sheet and menu lists them. */
export function messageActions(say: (key: MessageKey) => string, message: Message, me: string, handlers: LineHandlers)
{
    const mine = message.from === me;
    const list: ChatAction[] = [];

    if (handlers.onReply !== undefined)
    {
        list.push({ id: 'reply', icon: 'reply', label: say('chat.reply'), run: handlers.onReply });
    }

    list.push({ id: 'copy', icon: 'copy', label: say('chat.copy'), run: () => void copyText(message.text, 'chat.copied', { dedupe: 'chat-copy' }) });

    if (handlers.onForward !== undefined)
    {
        list.push({ id: 'forward', icon: 'forward', label: say('chat.forward'), run: handlers.onForward });
    }

    if (!mine && handlers.onPerson !== undefined)
    {
        list.push({ id: 'person', icon: 'me', label: say('chat.aboutSender'), run: handlers.onPerson });
    }

    if (mine && handlers.onDelete !== undefined)
    {
        list.push({ id: 'delete', icon: 'trash', label: say('chat.delete'), danger: true, run: handlers.onDelete });
    }

    return list;
}

/** Where a menu was asked for, in the window's own pixels. */
export interface MenuPoint
{
    x: number;
    y: number;
}

/** The reactions a line's menu opens with, and the way to the rest of them. */
export interface MenuReactions
{
    emoji: readonly string[];
    mine: (emoji: string) => boolean;
    pick: (emoji: string) => void;
    more: () => void;
}

/** An icon that points along the reading direction turns with it. */
export const flips = (icon: IconName) => icon === 'reply' || icon === 'forward';
