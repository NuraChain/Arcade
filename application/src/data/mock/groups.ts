import type { Group } from './types.ts';

export interface GroupSeed
{
    id: string;
    name: Group['name'];
    blurb: Group['blurb'];
    emoji: string;
    game: Group['game'];
    members: string[];
    owner: string;
    ageDays: number;
}

export const GROUPS: GroupSeed[] = [
    { id: 'g-friday', name: { en: 'Friday Night Crew', fa: 'اکیپ جمعه‌شب' }, blurb: { en: 'Hokm at nine, tea at ten, arguments until midnight.', fa: 'حکم ساعت نه، چای ساعت ده، بحث تا نیمه‌شب.' }, emoji: '🃏', game: 'hokm', members: ['babak', 'sara', 'leila', 'mahsa', 'mina', 'alex'], owner: 'babak', ageDays: 140 },
    { id: 'g-balcony', name: { en: 'Balcony Backgammon', fa: 'تخته‌نرد بالکن' }, blurb: { en: 'Two boards, one balcony, no doubling before noon.', fa: 'دو تخته، یک بالکن، قبل از ظهر دوبل ممنوع.' }, emoji: '🎲', game: 'backgammon', members: ['alex', 'reza', 'parisa', 'farhad', 'dariush'], owner: 'reza', ageDays: 88 },
    { id: 'g-lunch', name: { en: 'Lunch Ludo', fa: 'منچ ناهار' }, blurb: { en: 'Twenty minutes, four colours, back to work.', fa: 'بیست دقیقه، چهار رنگ، برگشت سر کار.' }, emoji: '🟡', game: 'ludo', members: ['roya', 'yasmin', 'hamed', 'tara', 'kian'], owner: 'roya', ageDays: 51 },
    { id: 'g-midnight', name: { en: 'Midnight Table', fa: 'میز نیمه‌شب' }, blurb: { en: 'Play-money poker for people who should be asleep.', fa: 'پوکر با پول بازی، برای کسانی که باید خواب باشند.' }, emoji: '🌙', game: 'poker', members: ['nima', 'omid', 'niloufar', 'sina', 'alex'], owner: 'omid', ageDays: 33 },
    { id: 'g-newcomers', name: { en: 'Newcomers’ Table', fa: 'میز تازه‌واردها' }, blurb: { en: 'Learn Hokm without anyone sighing.', fa: 'حکم یاد بگیر بدون این‌که کسی آه بکشد.' }, emoji: '🌱', game: null, members: ['elham', 'shirin', 'maya', 'leila'], owner: 'leila', ageDays: 12 }
];
