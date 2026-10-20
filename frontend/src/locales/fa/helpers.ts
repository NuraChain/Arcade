import type { Dictionary } from '../en/index.ts';
import type { helpers as reference } from '../en/helpers.ts';

export const helpers: Pick<Dictionary, keyof typeof reference> = {
    'helpers.title': 'کمک‌های بازی',
    'helpers.lead': 'موقع بازی کمکت می‌کنن. هر کدوم رو می‌تونی همین‌جا یا از منوی میز خاموش کنی.',
    'helpers.moves': 'حرکت‌های ممکن رو نشون بده',
    'helpers.movesHint': 'مهره‌ها و کارت‌هایی که همین الان می‌تونی بازی کنی روشن می‌شن.',
    'helpers.outcome': 'بگو هر حرکت چی کار می‌کنه',
    'helpers.outcomeHint': 'قبل از اینکه حرکت کنی، می‌گه مهره می‌زنه، دست رو می‌بره یا مهره رو بیرون می‌بره.',
    'helpers.rules': 'مربی قانون‌ها',
    'helpers.rulesHint': 'یه نکته‌ی کوتاه درباره‌ی قانونی که همین الان مهمه.',
    'helpers.tip': 'نکته',
    'helpers.moves.show': 'حرکت‌های ممکن رو نشون بده',
    'helpers.moves.hide': 'حرکت‌های ممکن رو نشون نده',
    'helpers.outcome.show': 'بگو هر حرکت چی کار می‌کنه',
    'helpers.outcome.hide': 'دیگه نگو هر حرکت چی کار می‌کنه',
    'helpers.rules.show': 'مربی قانون‌ها رو روشن کن',
    'helpers.rules.hide': 'مربی قانون‌ها رو خاموش کن'
};
