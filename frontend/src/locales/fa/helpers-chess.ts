import type { Dictionary } from '../en/index.ts';
import type { helpersChess as reference } from '../en/helpers-chess.ts';

export const helpersChess: Pick<Dictionary, keyof typeof reference> = {
    'helpers.chess.tip.first': 'ساعتت از اولین حرکتت راه می‌افته. تا ۳۰ ثانیه حرکت کن، وگرنه بازی لغو می‌شه و واسه هیچ‌کس حساب نمی‌شه.',
    'helpers.chess.tip.waitFirst': 'اگه حریف تا ۳۰ ثانیه اولین حرکتش رو نکنه، بازی لغو می‌شه و واسه هیچ‌کس حساب نمی‌شه.',
    'helpers.chess.tip.check': 'کیش شدی: یا شاهت رو جابه‌جا کن، یا یه مهره بذار سر راه، یا مهره‌ای که کیش داده رو بزن.',
    'helpers.chess.tip.checkKing': 'از این کیش فقط خود شاه می‌تونه در بره: ببرش یه خونه‌ای که هیچ مهره‌ای تهدیدش نمی‌کنه.',
    'helpers.chess.tip.promote': 'سربازی که به ردیف آخر برسه وزیر، رخ، فیل یا اسب می‌شه. انتخابش با خودته.',
    'helpers.chess.tip.passant': 'سربازی که همین الان دو خونه اومد جلو رو می‌شه آن‌پاسان زد، انگار فقط یه خونه اومده. فقط همین حرکت فرصتشو داری.',
    'helpers.chess.tip.time': 'کمتر از یه دقیقه وقت داری. اگه وقتت تموم بشه می‌بازی، مگه این‌که حریف دیگه مهره‌ی کافی واسه مات کردن نداشته باشه.',
    'helpers.chess.tip.castle': 'می‌تونی قلعه بری: شاه رو دو خونه به سمت رخ ببر، رخ از روش می‌پره اون طرف.',
    'helpers.chess.tip.fifty': 'اگه پنجاه حرکت هر دو طرف بدون زدن مهره و بدون حرکت سرباز بگذره، بازی مساوی می‌شه، و این بازی نزدیک همونه.'
};
