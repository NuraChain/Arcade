import type { LocalizedText } from '../../lib/text.ts';
import type { GameId } from '../games.ts';
import type { Region, Skill } from './types.ts';

export interface PersonSeed
{
    id: string;
    handle: string;
    name: LocalizedText;
    bio: LocalizedText;
    hue: number;
    portrait: string | null;
    favourite: GameId;
    skill: Skill;
    region: Region;
    minor: boolean;
    demo: boolean;
}

export const PEOPLE: PersonSeed[] = [
    { id: 'alex', handle: 'alex', name: { en: 'Alex Morgan', fa: 'الکس مورگان' }, bio: { en: 'Backgammon on the balcony, poker after midnight.', fa: 'تخته‌نرد توی بالکن، پوکر بعد از نیمه‌شب.' }, hue: 32, portrait: null, favourite: 'backgammon', skill: 'regular', region: 'eu', minor: false, demo: true },
    { id: 'sara', handle: 'sara.k', name: { en: 'Sara Kamali', fa: 'سارا کمالی' }, bio: { en: 'Names the suit before the cards are dealt.', fa: 'قبل از پخش شدن ورق‌ها حکم را می‌گوید.' }, hue: 340, portrait: null, favourite: 'hokm', skill: 'sharp', region: 'me', minor: false, demo: true },
    { id: 'kian', handle: 'kian16', name: { en: 'Kian Nazari', fa: 'کیان نظری' }, bio: { en: 'Ludo with cousins every Friday.', fa: 'هر جمعه با پسرعموها منچ.' }, hue: 200, portrait: null, favourite: 'ludo', skill: 'casual', region: 'me', minor: true, demo: true },
    { id: 'reza', handle: 'reza.t', name: { en: 'Reza Tehrani', fa: 'رضا تهرانی' }, bio: { en: 'Doubling cube optimist.', fa: 'خوش‌بین به تاس دوبل.' }, hue: 18, portrait: null, favourite: 'backgammon', skill: 'expert', region: 'me', minor: false, demo: false },
    { id: 'mina', handle: 'mina', name: { en: 'Mina Sadeghi', fa: 'مینا صادقی' }, bio: { en: 'Slow player, fast talker.', fa: 'آهسته بازی می‌کند، تند حرف می‌زند.' }, hue: 280, portrait: null, favourite: 'hokm', skill: 'regular', region: 'me', minor: false, demo: false },
    { id: 'nima', handle: 'nima.f', name: { en: 'Nima Farahani', fa: 'نیما فراهانی' }, bio: { en: 'Folds too early, admits it too late.', fa: 'زود فولد می‌کند، دیر قبول می‌کند.' }, hue: 150, portrait: null, favourite: 'poker', skill: 'sharp', region: 'eu', minor: false, demo: false },
    { id: 'leila', handle: 'leila.a', name: { en: 'Leila Ahmadi', fa: 'لیلا احمدی' }, bio: { en: 'Keeps the score sheet. Keeps it honest.', fa: 'برگهٔ امتیاز دست اوست. و درست هم می‌نویسد.' }, hue: 48, portrait: null, favourite: 'hokm', skill: 'expert', region: 'me', minor: false, demo: false },
    { id: 'arash', handle: 'arash', name: { en: 'Arash Moradi', fa: 'آرش مرادی' }, bio: { en: 'Two dice, one opinion.', fa: 'دو تاس، یک نظر.' }, hue: 12, portrait: null, favourite: 'backgammon', skill: 'casual', region: 'me', minor: false, demo: false },
    { id: 'shirin', handle: 'shirin', name: { en: 'Shirin Rahimi', fa: 'شیرین رحیمی' }, bio: { en: 'Here for the tea between hands.', fa: 'برای چای بین دست‌ها اینجاست.' }, hue: 300, portrait: null, favourite: 'hokm', skill: 'new', region: 'me', minor: false, demo: false },
    { id: 'yasmin', handle: 'yas', name: { en: 'Yasmin Karimi', fa: 'یاسمین کریمی' }, bio: { en: 'Four colours, one winner, no arguments.', fa: 'چهار رنگ، یک برنده، بی‌بحث.' }, hue: 90, portrait: null, favourite: 'ludo', skill: 'regular', region: 'eu', minor: false, demo: false },
    { id: 'omid', handle: 'omid.j', name: { en: 'Omid Jafari', fa: 'امید جعفری' }, bio: { en: 'Plays the player, not the cards.', fa: 'با آدم بازی می‌کند، نه با ورق.' }, hue: 220, portrait: null, favourite: 'poker', skill: 'expert', region: 'na', minor: false, demo: false },
    { id: 'parisa', handle: 'parisa', name: { en: 'Parisa Hosseini', fa: 'پریسا حسینی' }, bio: { en: 'Never resigns. Never.', fa: 'هرگز تسلیم نمی‌شود. هرگز.' }, hue: 330, portrait: null, favourite: 'backgammon', skill: 'sharp', region: 'me', minor: false, demo: false },
    { id: 'babak', handle: 'babak.r', name: { en: 'Babak Rostami', fa: 'بابک رستمی' }, bio: { en: 'Hosts the Friday table.', fa: 'میزبان میز جمعه‌ها.' }, hue: 60, portrait: null, favourite: 'hokm', skill: 'regular', region: 'me', minor: false, demo: false },
    { id: 'niloufar', handle: 'nilou', name: { en: 'Niloufar Azimi', fa: 'نیلوفر عظیمی' }, bio: { en: 'Counts the pot before the flop.', fa: 'قبل از فلاپ پات را می‌شمارد.' }, hue: 260, portrait: null, favourite: 'poker', skill: 'regular', region: 'eu', minor: false, demo: false },
    { id: 'farhad', handle: 'farhad', name: { en: 'Farhad Ebrahimi', fa: 'فرهاد ابراهیمی' }, bio: { en: 'Retired champion, active heckler.', fa: 'قهرمان بازنشسته، تماشاچی فعال.' }, hue: 170, portrait: null, favourite: 'backgammon', skill: 'expert', region: 'me', minor: false, demo: false },
    { id: 'roya', handle: 'roya.m', name: { en: 'Roya Mousavi', fa: 'رؤیا موسوی' }, bio: { en: 'Ludo at lunch. Every lunch.', fa: 'منچ سر ناهار. هر ناهار.' }, hue: 110, portrait: null, favourite: 'ludo', skill: 'casual', region: 'me', minor: false, demo: false },
    { id: 'sina', handle: 'sina.g', name: { en: 'Sina Ghasemi', fa: 'سینا قاسمی' }, bio: { en: 'Bluffs with a straight face and a shaky hand.', fa: 'با صورت جدی و دست لرزان بلوف می‌زند.' }, hue: 240, portrait: null, favourite: 'poker', skill: 'casual', region: 'asia', minor: false, demo: false },
    { id: 'mahsa', handle: 'mahsa', name: { en: 'Mahsa Nouri', fa: 'مهسا نوری' }, bio: { en: 'Partners with Leila. Wins with Leila.', fa: 'یار لیلا. برندهٔ کنار لیلا.' }, hue: 20, portrait: null, favourite: 'hokm', skill: 'sharp', region: 'me', minor: false, demo: false },
    { id: 'dariush', handle: 'dariush', name: { en: 'Dariush Kaveh', fa: 'داریوش کاوه' }, bio: { en: 'Plays one game a night and means it.', fa: 'شبی یک بازی، اما جدی.' }, hue: 190, portrait: null, favourite: 'backgammon', skill: 'regular', region: 'na', minor: false, demo: false },
    { id: 'elham', handle: 'elham.b', name: { en: 'Elham Bagheri', fa: 'الهام باقری' }, bio: { en: 'New here. Learning Hokm the hard way.', fa: 'تازه‌وارد. حکم را از راه سخت یاد می‌گیرد.' }, hue: 350, portrait: null, favourite: 'hokm', skill: 'new', region: 'me', minor: false, demo: false },
    { id: 'hamed', handle: 'hamed.z', name: { en: 'Hamed Zamani', fa: 'حامد زمانی' }, bio: { en: 'Rolls doubles when it matters least.', fa: 'وقتی اصلاً مهم نیست جفت می‌آورد.' }, hue: 80, portrait: null, favourite: 'ludo', skill: 'regular', region: 'me', minor: false, demo: false },
    { id: 'tara', handle: 'tara.y', name: { en: 'Tara Yousefi', fa: 'تارا یوسفی' }, bio: { en: 'Will rematch until she wins.', fa: 'تا نبرد، دوباره بازی می‌کند.' }, hue: 310, portrait: null, favourite: 'ludo', skill: 'sharp', region: 'eu', minor: false, demo: false },
    { id: 'peyman', handle: 'peyman', name: { en: 'Peyman Salehi', fa: 'پیمان صالحی' }, bio: { en: 'Quiet table, loud dice.', fa: 'میز ساکت، تاس پرصدا.' }, hue: 130, portrait: null, favourite: 'backgammon', skill: 'casual', region: 'me', minor: false, demo: false },
    { id: 'maya', handle: 'maya.c', name: { en: 'Maya Chen', fa: 'مایا چن' }, bio: { en: 'Learned Hokm from a roommate, never looked back.', fa: 'حکم را از هم‌خانه‌اش یاد گرفت و دیگر برنگشت.' }, hue: 210, portrait: null, favourite: 'hokm', skill: 'regular', region: 'na', minor: false, demo: false }
];

export const DEMO_IDS = PEOPLE.filter((person) => person.demo).map((person) => person.id);
