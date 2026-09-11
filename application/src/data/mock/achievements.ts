import type { Achievement } from './types.ts';

export const ACHIEVEMENTS: Achievement[] = [
    { id: 'first-seat', name: { en: 'First seat', fa: 'اولین صندلی' }, blurb: { en: 'Sat down at a table.', fa: 'سر یک میز نشستی.' }, icon: 'seat', tier: 'bronze' },
    { id: 'first-win', name: { en: 'First win', fa: 'اولین برد' }, blurb: { en: 'Won a game, any game.', fa: 'یک بازی را بردی، هر بازی‌ای.' }, icon: 'trophy', tier: 'bronze' },
    { id: 'regular', name: { en: 'Regular', fa: 'پای ثابت' }, blurb: { en: 'Played on seven different days.', fa: 'در هفت روز متفاوت بازی کردی.' }, icon: 'history', tier: 'bronze' },
    { id: 'host', name: { en: 'Host', fa: 'میزبان' }, blurb: { en: 'Opened a private table and filled it.', fa: 'یک میز خصوصی باز کردی و پرش کردی.' }, icon: 'invite', tier: 'bronze' },
    { id: 'streak-3', name: { en: 'On a roll', fa: 'روی دور' }, blurb: { en: 'Three wins in a row.', fa: 'سه برد پشت سر هم.' }, icon: 'flame', tier: 'silver' },
    { id: 'hokm-trump', name: { en: 'Called it', fa: 'حکمش درست بود' }, blurb: { en: 'Named trump and took all seven.', fa: 'حکم گفتی و هر هفت دست را بردی.' }, icon: 'cards', tier: 'silver' },
    { id: 'gammon', name: { en: 'Gammon', fa: 'مارس' }, blurb: { en: 'Won before your opponent bore off a single checker.', fa: 'بردی پیش از آن‌که حریف حتی یک مهره خارج کند.' }, icon: 'dice', tier: 'silver' },
    { id: 'cube-taker', name: { en: 'Cube taker', fa: 'دوبل‌گیر' }, blurb: { en: 'Accepted a double and won the game.', fa: 'دوبل را قبول کردی و بازی را بردی.' }, icon: 'dice', tier: 'silver' },
    { id: 'crew', name: { en: 'Crew', fa: 'اکیپ' }, blurb: { en: 'Played with the same three people ten times.', fa: 'ده بار با همان سه نفر بازی کردی.' }, icon: 'people', tier: 'silver' },
    { id: 'streak-7', name: { en: 'Unstoppable', fa: 'توقف‌ناپذیر' }, blurb: { en: 'Seven wins in a row.', fa: 'هفت برد پشت سر هم.' }, icon: 'zap', tier: 'gold' },
    { id: 'centurion', name: { en: 'Hundred hands', fa: 'صد دست' }, blurb: { en: 'A hundred games played.', fa: 'صد بازی انجام شده.' }, icon: 'medal', tier: 'gold' },
    { id: 'fair', name: { en: 'Good sport', fa: 'بازیکن منصف' }, blurb: { en: 'Fifty games without a single walkout.', fa: 'پنجاه بازی بدون حتی یک ترک میز.' }, icon: 'shield', tier: 'gold' }
];

export function achievementById(id: string): Achievement | undefined
{
    return ACHIEVEMENTS.find((achievement) => achievement.id === id);
}
