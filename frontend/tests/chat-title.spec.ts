import { describe, it, expect } from 'vitest';

import { sealSentenceOf } from '../src/components/chat/chat-title.ts';
import { SealFailure } from '../src/services/chat.source.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import '../src/locales/app-catalogue.ts';

describe('what a line that did not go says', () =>
{
    it('blames the sealing only for a sealing failure', () =>
    {
        const locale = useLocale();

        locale.setLocale('en');

        expect(sealSentenceOf(new TypeError('Failed to fetch'), locale.t), 'a request that never arrived').toBe(locale.t('common.actionFailed'));
        expect(sealSentenceOf(new SealFailure('no-keys', null), locale.t)).toBe(locale.t('seal.noKeysHere'));
        expect(sealSentenceOf(new SealFailure('not-sealable', null), locale.t), 'a sealing failure that names nobody').toBe(locale.t('chat.sealedOnly'));
    });
});
