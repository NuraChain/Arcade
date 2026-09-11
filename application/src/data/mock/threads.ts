import type { LocalizedText } from '../../lib/text.ts';
import type { GameId } from '../games.ts';
import type { ConversationKind, MessageKind } from './types.ts';

export interface MessageSeed
{
    from: string;
    minutesAgo: number;
    text: LocalizedText;
    kind?: MessageKind;
    game?: GameId;
    winnerId?: string;
}

export interface ThreadSeed
{
    id: string;
    kind: ConversationKind;
    participants: string[];
    groupId: string | null;
    game: GameId | null;
    pinned: boolean;
    unreadFrom: number;
    messages: MessageSeed[];
}

export const THREADS: ThreadSeed[] = [
    {
        id: 'c-sara',
        kind: 'direct',
        participants: ['alex', 'sara'],
        groupId: null,
        game: null,
        pinned: true,
        unreadFrom: 2,
        messages: [
            { from: 'sara', minutesAgo: 190, text: { en: 'Friday is on. Babak booked the big table.', fa: 'جمعه قطعیه. بابک میز بزرگ رو گرفته.' } },
            { from: 'alex', minutesAgo: 186, text: { en: 'Partners the same as last time?', fa: 'یارها مثل دفعهٔ قبل؟' } },
            { from: 'sara', minutesAgo: 184, text: { en: 'Only if you stop leading with the ace.', fa: 'فقط اگه با آس شروع نکنی.' } },
            { from: 'sara', minutesAgo: 14, text: { en: 'Free now? One game of backgammon before dinner.', fa: 'الان آزادی؟ یه دست تخته قبل شام.' } },
            { from: 'sara', minutesAgo: 13, text: { en: 'Backgammon, three points', fa: 'تخته‌نرد، سه امتیاز' }, kind: 'invite', game: 'backgammon' }
        ]
    },
    {
        id: 'c-reza',
        kind: 'direct',
        participants: ['alex', 'reza'],
        groupId: null,
        game: null,
        pinned: false,
        unreadFrom: 0,
        messages: [
            { from: 'reza', minutesAgo: 1500, text: { en: 'That double was a bluff and you took it anyway.', fa: 'اون دوبل بلوف بود و تو قبولش کردی.' } },
            { from: 'alex', minutesAgo: 1490, text: { en: 'And won. Say it.', fa: 'و بردم. بگو.' } },
            { from: 'reza', minutesAgo: 1488, text: { en: 'Gammon', fa: 'مارس' }, kind: 'result', game: 'backgammon', winnerId: 'alex' },
            { from: 'reza', minutesAgo: 1487, text: { en: 'Rematch tomorrow. Balcony.', fa: 'فردا بازی مجدد. بالکن.' } }
        ]
    },
    {
        id: 'c-parisa',
        kind: 'direct',
        participants: ['alex', 'parisa'],
        groupId: null,
        game: null,
        pinned: false,
        unreadFrom: 1,
        messages: [
            { from: 'alex', minutesAgo: 2900, text: { en: 'Good game. You never resign, do you.', fa: 'بازی خوبی بود. تو هیچ‌وقت تسلیم نمی‌شی، نه؟' } },
            { from: 'parisa', minutesAgo: 2880, text: { en: 'Never.', fa: 'هرگز.' } },
            { from: 'parisa', minutesAgo: 60, text: { en: 'Balcony group is playing tonight, you in?', fa: 'گروه بالکن امشب بازی می‌کنه، هستی؟' } }
        ]
    },
    {
        id: 'c-nima',
        kind: 'direct',
        participants: ['alex', 'nima'],
        groupId: null,
        game: null,
        pinned: false,
        unreadFrom: 0,
        messages: [
            { from: 'nima', minutesAgo: 4300, text: { en: 'Midnight table needs a sixth.', fa: 'میز نیمه‌شب یه نفر ششم می‌خواد.' } },
            { from: 'alex', minutesAgo: 4290, text: { en: 'Play money?', fa: 'پول بازی؟' } },
            { from: 'nima', minutesAgo: 4289, text: { en: 'Always. Omid’s rule.', fa: 'همیشه. قانون امیده.' } }
        ]
    },
    {
        id: 'c-friday',
        kind: 'group',
        participants: ['babak', 'sara', 'leila', 'mahsa', 'mina', 'alex'],
        groupId: 'g-friday',
        game: 'hokm',
        pinned: true,
        unreadFrom: 3,
        messages: [
            { from: 'babak', minutesAgo: 400, text: { en: 'Friday, nine sharp. Big table.', fa: 'جمعه، رأس نه. میز بزرگ.' } },
            { from: 'leila', minutesAgo: 380, text: { en: 'I’m keeping score again. Nobody argues.', fa: 'باز من امتیاز می‌نویسم. کسی بحث نکنه.' } },
            { from: 'mahsa', minutesAgo: 375, text: { en: 'We argue with love.', fa: 'ما با عشق بحث می‌کنیم.' } },
            { from: 'mina', minutesAgo: 45, text: { en: 'Can we do a warm-up hand tonight?', fa: 'می‌شه امشب یه دست گرم‌کننده بزنیم؟' } },
            { from: 'sara', minutesAgo: 40, text: { en: 'Hokm, seven hands', fa: 'حکم، هفت دست' }, kind: 'invite', game: 'hokm' },
            { from: 'babak', minutesAgo: 38, text: { en: 'Three of us in. One seat left.', fa: 'سه نفرمون هستیم. یه صندلی مونده.' } }
        ]
    },
    {
        id: 'c-balcony',
        kind: 'group',
        participants: ['alex', 'reza', 'parisa', 'farhad', 'dariush'],
        groupId: 'g-balcony',
        game: 'backgammon',
        pinned: false,
        unreadFrom: 0,
        messages: [
            { from: 'farhad', minutesAgo: 2000, text: { en: 'Retired champion says: no cube before noon.', fa: 'قهرمان بازنشسته می‌گه: قبل از ظهر دوبل ممنوع.' } },
            { from: 'dariush', minutesAgo: 1990, text: { en: 'One game a night. I mean it this time.', fa: 'شبی یک بازی. این بار جدی‌ام.' } },
            { from: 'reza', minutesAgo: 1980, text: { en: 'Backgammon, five points', fa: 'تخته‌نرد، پنج امتیاز' }, kind: 'invite', game: 'backgammon' }
        ]
    },
    {
        id: 'c-midnight',
        kind: 'group',
        participants: ['nima', 'omid', 'niloufar', 'sina', 'alex'],
        groupId: 'g-midnight',
        game: 'poker',
        pinned: false,
        unreadFrom: 1,
        messages: [
            { from: 'omid', minutesAgo: 700, text: { en: 'House rule reminder: play money, low blinds, no sulking.', fa: 'یادآوری قانون خونه: پول بازی، بلایند کم، قهر ممنوع.' } },
            { from: 'niloufar', minutesAgo: 690, text: { en: 'I counted the pot already. It’s mine.', fa: 'پات رو از الان شمردم. مال منه.' } },
            { from: 'sina', minutesAgo: 120, text: { en: 'Tonight? My hand is steadier than last time.', fa: 'امشب؟ دستم از دفعهٔ قبل ثابت‌تره.' } }
        ]
    },
    {
        id: 'c-lunch',
        kind: 'group',
        participants: ['roya', 'yasmin', 'hamed', 'tara', 'kian'],
        groupId: 'g-lunch',
        game: 'ludo',
        pinned: true,
        unreadFrom: 2,
        messages: [
            { from: 'roya', minutesAgo: 300, text: { en: 'Twenty minutes tomorrow. Quick rules.', fa: 'فردا بیست دقیقه. قانون سریع.' } },
            { from: 'tara', minutesAgo: 280, text: { en: 'I want a rematch for yesterday.', fa: 'برای دیروز بازی مجدد می‌خوام.' } },
            { from: 'hamed', minutesAgo: 30, text: { en: 'Ludo, four players', fa: 'منچ، چهار نفره' }, kind: 'invite', game: 'ludo' },
            { from: 'yasmin', minutesAgo: 28, text: { en: 'I call yellow.', fa: 'زرد مال منه.' } }
        ]
    },
    {
        id: 'c-newcomers',
        kind: 'group',
        participants: ['elham', 'shirin', 'maya', 'leila'],
        groupId: 'g-newcomers',
        game: null,
        pinned: false,
        unreadFrom: 0,
        messages: [
            { from: 'leila', minutesAgo: 900, text: { en: 'Trump beats everything. Even friendship, briefly.', fa: 'حکم همه‌چیز رو می‌بره. حتی دوستی رو، برای یه لحظه.' } },
            { from: 'elham', minutesAgo: 880, text: { en: 'So when do I say it?', fa: 'پس کی باید بگم؟' } },
            { from: 'maya', minutesAgo: 870, text: { en: 'After you see your first five cards. Then never doubt it.', fa: 'بعد از این‌که پنج ورق اولت رو دیدی. بعدش دیگه شک نکن.' } }
        ]
    },
    {
        id: 'c-sara-leila',
        kind: 'direct',
        participants: ['sara', 'leila'],
        groupId: null,
        game: null,
        pinned: false,
        unreadFrom: 1,
        messages: [
            { from: 'leila', minutesAgo: 95, text: { en: 'Mahsa and I are unbeatable this week. Warning you.', fa: 'من و مهسا این هفته شکست‌ناپذیریم. هشدار دادم.' } },
            { from: 'sara', minutesAgo: 90, text: { en: 'We’ll see on Friday.', fa: 'جمعه می‌بینیم.' } },
            { from: 'leila', minutesAgo: 20, text: { en: 'Warm-up tonight?', fa: 'امشب گرم‌کننده؟' } }
        ]
    },
    {
        id: 'c-kian-roya',
        kind: 'direct',
        participants: ['kian', 'roya'],
        groupId: null,
        game: null,
        pinned: false,
        unreadFrom: 1,
        messages: [
            { from: 'roya', minutesAgo: 50, text: { en: 'Bring the cousins Friday, we need four.', fa: 'جمعه پسرعموها رو بیار، چهار نفر لازم داریم.' } },
            { from: 'kian', minutesAgo: 48, text: { en: 'They only play if they get red.', fa: 'فقط اگه قرمز بگیرن بازی می‌کنن.' } },
            { from: 'roya', minutesAgo: 10, text: { en: 'Ludo, four players', fa: 'منچ، چهار نفره' }, kind: 'invite', game: 'ludo' }
        ]
    }
];
