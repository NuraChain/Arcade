import type { LocalizedText } from '../../lib/text.ts';
import type { GameId } from '../games.ts';

export const REPLIES: Record<GameId | 'general', LocalizedText[]> = {
    general: [
        { en: 'Give me two minutes, kettle’s on.', fa: 'دو دقیقه صبر کن، کتری روی گازه.' },
        { en: 'I’m in. Who else?', fa: 'من هستم. دیگه کی هست؟' },
        { en: 'Only if we play best of three.', fa: 'فقط اگه سه دست بازی کنیم.' },
        { en: 'Rematch from last night still owed, remember.', fa: 'یادت نره، بازی مجدد دیشب هنوز بدهکاری.' },
        { en: 'Send the table, I’ll sit down from the bus.', fa: 'میز رو بفرست، از توی اتوبوس می‌شینم.' },
        { en: 'Can we make it turn-based? Long day.', fa: 'می‌شه نوبتی بازی کنیم؟ روز طولانی‌ای بود.' }
    ],
    hokm: [
        { en: 'Hearts. Always hearts.', fa: 'دل. همیشه دل.' },
        { en: 'Leila’s calling trump again, brace yourselves.', fa: 'لیلا باز داره حکم می‌گه، آماده باشید.' },
        { en: 'Partners the same as Friday?', fa: 'یارها همون جمعه؟' },
        { en: 'Seven hands and then tea, that’s the deal.', fa: 'هفت دست و بعد چای، قرارمون همینه.' }
    ],
    poker: [
        { en: 'Play money only, before anyone asks.', fa: 'فقط پول بازی، قبل از این‌که کسی بپرسه.' },
        { en: 'Low blinds, I’m tired.', fa: 'بلایند کم، خسته‌ام.' },
        { en: 'You fold too early and you know it.', fa: 'زود فولد می‌کنی و خودت می‌دونی.' },
        { en: 'Six seats open. Bring Nima.', fa: 'شش صندلی خالیه. نیما رو بیار.' }
    ],
    backgammon: [
        { en: 'Cube on the table where I can see it.', fa: 'دوبل روی میز، جایی که ببینمش.' },
        { en: 'Three points. No, five. Fine, three.', fa: 'سه امتیاز. نه، پنج. باشه، سه.' },
        { en: 'I’m still counting your doubles from last time.', fa: 'هنوز دارم جفت‌های دفعهٔ قبلت رو می‌شمارم.' },
        { en: 'Balcony in ten?', fa: 'ده دقیقه دیگه بالکن؟' }
    ],
    ludo: [
        { en: 'I call red.', fa: 'قرمز مال منه.' },
        { en: 'Quick rules, we have twenty minutes.', fa: 'قانون سریع، بیست دقیقه وقت داریم.' },
        { en: 'Kian is bringing his cousins again.', fa: 'کیان باز پسرعموهاش رو میاره.' },
        { en: 'Last one to sit down deals the dice.', fa: 'آخرین نفری که بشینه تاس رو می‌ریزه.' }
    ]
};

export const AMBIENT: LocalizedText[] = [
    { en: 'Anyone up for a quick one before dinner?', fa: 'کسی هست قبل شام یه دست سریع بزنیم؟' },
    { en: 'Won two in a row, then the dice remembered who I was.', fa: 'دو تا پشت هم بردم، بعد تاس یادش اومد من کی‌ام.' },
    { en: 'The new score sheet in the app is very good.', fa: 'برگهٔ امتیاز جدید توی برنامه خیلی خوبه.' },
    { en: 'Table’s open, lights are on.', fa: 'میز بازه، چراغ‌ها روشنه.' },
    { en: 'Who taught Elham to bluff? Not funny anymore.', fa: 'کی به الهام بلوف زدن یاد داده؟ دیگه خنده‌دار نیست.' }
];

export const SYSTEM: Record<'started' | 'finished' | 'joined' | 'left' | 'created', LocalizedText> = {
    started: { en: 'The game started.', fa: 'بازی شروع شد.' },
    finished: { en: 'The game ended.', fa: 'بازی تمام شد.' },
    joined: { en: '{name} sat down.', fa: '{name} نشست.' },
    left: { en: '{name} left the table.', fa: '{name} میز را ترک کرد.' },
    created: { en: '{name} opened a table.', fa: '{name} یک میز باز کرد.' }
};
