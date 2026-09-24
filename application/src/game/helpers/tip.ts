import type { MessageKey } from '../../locales/en/index.ts';

export interface Tip
{
    key: MessageKey;
    params?: Record<string, string | number>;
}
