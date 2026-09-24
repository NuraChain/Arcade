import type { Dictionary } from '../en/index.ts';
import type { helpers as reference } from '../en/helpers.ts';

export const helpers: Pick<Dictionary, keyof typeof reference> = {
    'helpers.title': 'کمک‌های بازی',
    'helpers.lead': 'کمک در حین بازی. هر کدام را اینجا یا از منوی میز می‌توانی خاموش کنی.',
    'helpers.moves': 'نشان دادن حرکت‌های ممکن',
    'helpers.movesHint': 'مهره‌ها و کارت‌هایی را که همین حالا می‌توانی بازی کنی روشن کن.',
    'helpers.outcome': 'گفتن نتیجهٔ هر حرکت',
    'helpers.outcomeHint': 'پیش از بازی کردن بگو که مهره می‌زند، دست را می‌برد یا مهره را جمع می‌کند.',
    'helpers.rules': 'مربی قوانین',
    'helpers.rulesHint': 'یک نکتهٔ کوتاه دربارهٔ قانونی که همین حالا مهم است.',
    'helpers.tip': 'نکته',
    'helpers.moves.show': 'حرکت‌های ممکن را نشان بده',
    'helpers.moves.hide': 'حرکت‌های ممکن را پنهان کن',
    'helpers.outcome.show': 'نتیجهٔ حرکت را بگو',
    'helpers.outcome.hide': 'نتیجهٔ حرکت را نگو',
    'helpers.rules.show': 'مربی قوانین را روشن کن',
    'helpers.rules.hide': 'مربی قوانین را خاموش کن'
};
