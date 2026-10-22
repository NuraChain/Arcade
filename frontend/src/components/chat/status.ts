import type { IconName } from '../../icons/registry.ts';
import type { MessageKey } from '../../locales/en.ts';

/** What became of a line of the reader's, as its mark says it. */
export type LineStatus = 'sending' | 'sent' | 'read' | 'failed';

export const STATUS_ICON: Record<LineStatus, IconName> = {
    sending: 'clock',
    sent: 'sent',
    read: 'read',
    failed: 'alert'
};

export const STATUS_WORDS: Record<LineStatus, MessageKey> = {
    sending: 'chat.sending',
    sent: 'chat.sent',
    read: 'chat.read',
    failed: 'chat.unsent'
};
