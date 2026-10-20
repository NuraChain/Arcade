import type { Dictionary } from '../en/index.ts';
import type { helpersBackgammon as reference } from '../en/helpers-backgammon.ts';

export const helpersBackgammon: Pick<Dictionary, keyof typeof reference> = {
    'helpers.backgammon.bar': 'مهره‌ای که وسطه اول باید وارد بشه. تا وارد نشه، هیچ مهره‌ی دیگه‌ای تکون نمی‌خوره.',
    'helpers.backgammon.doubles': 'جفت اومده، پس چهار بار بازی می‌شه: چهار تا حرکت {die} خونه‌ای.',
    'helpers.backgammon.both': 'هر وقت بشه باید هر دو تاس بازی بشن، واسه همین حرکتی که تاس دیگه رو بی‌جا بذاره پیشنهاد نمی‌شه.',
    'helpers.backgammon.higher': 'این‌جا فقط یکی از تاس‌ها بازی می‌شه، و وقتی هر دو جا دارن باید تاس بزرگ‌تر باشه: {die}.',
    'helpers.backgammon.bear': 'همه‌ی مهره‌هات رسیدن خونه، پس حالا می‌تونی بیرونشون ببری.',
    'helpers.backgammon.double': 'قبل از تاس ریختن می‌تونی دوبل کنی: روی مکعب بزن. اون‌وقت حریف یا با {cube} ادامه می‌ده یا این دست رو واگذار می‌کنه.',
    'helpers.backgammon.take': 'اگه قبول کنی، این دست با {cube} ادامه پیدا می‌کنه. اگه واگذار کنی، همین الان با {now} تموم می‌شه.'
};
