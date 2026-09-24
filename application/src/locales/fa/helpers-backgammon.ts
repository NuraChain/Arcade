import type { Dictionary } from '../en/index.ts';
import type { helpersBackgammon as reference } from '../en/helpers-backgammon.ts';

export const helpersBackgammon: Pick<Dictionary, keyof typeof reference> = {
    'helpers.backgammon.hop.hit': 'بردن یک مهره از {from} به {to} و زدن مهرهٔ تک آنجا',
    'helpers.backgammon.hop.enter': 'وارد کردن یک مهره از وسط به {to}',
    'helpers.backgammon.hop.enterHit': 'وارد کردن یک مهره از وسط به {to} و زدن مهرهٔ تک آنجا',
    'helpers.backgammon.hop.off': 'بیرون بردن یک مهره از {from}',
    'helpers.backgammon.tag.hit': 'زدن',
    'helpers.backgammon.bar': 'مهره‌ای که وسط است اول باید وارد شود. تا وارد نشده، هیچ مهرهٔ دیگری حرکت نمی‌کند.',
    'helpers.backgammon.doubles': 'جفت آمده، پس چهار بار بازی می‌شود: چهار حرکت {die} خانه‌ای.',
    'helpers.backgammon.both': 'هر وقت بشود باید هر دو تاس بازی شوند، برای همین حرکتی که تاس دیگر را بی‌جا بگذارد پیشنهاد نمی‌شود.',
    'helpers.backgammon.higher': 'اینجا فقط یکی از تاس‌ها بازی می‌شود و وقتی هر دو جا دارند باید تاس بزرگ‌تر باشد: {die}.',
    'helpers.backgammon.bear': 'همهٔ مهره‌هایت به خانه رسیده‌اند، پس حالا می‌توانی بیرونشان ببری.',
    'helpers.backgammon.double': 'پیش از تاس ریختن می‌توانی دوبل کنی. آن وقت حریف یا با {cube} ادامه می‌دهد یا این دست را واگذار می‌کند.',
    'helpers.backgammon.take': 'اگر قبول کنی، این دست با {cube} ادامه پیدا می‌کند. اگر واگذار کنی، همین حالا با {now} تمام می‌شود.'
};
