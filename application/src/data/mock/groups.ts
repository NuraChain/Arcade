import type { IconName } from '../../icons/registry.ts';
import type { Group } from './types.ts';

export interface GroupSeed
{
    id: string;
    name: Group['name'];
    blurb: Group['blurb'];
    crest: IconName;
    hue: number;
    game: Group['game'];
    members: string[];
    owner: string;
    ageDays: number;
}

export const GROUPS: GroupSeed[] = [
    { id: 'g-friday', name: { en: 'Friday Night Crew', fa: 'اکیپ جمعه‌شب' }, blurb: { en: 'Hokm at nine, tea at ten, arguments until midnight.', fa: 'حکم ساعت نه، چای ساعت ده، بحث تا نیمه‌شب.' }, crest: 'crest-crown', hue: 45, game: 'hokm', members: ['babak.r', 'sara.k', 'leila.a', 'mahsa', 'mina', 'alex'], owner: 'babak.r', ageDays: 140 },
    { id: 'g-balcony', name: { en: 'Balcony Backgammon', fa: 'تخته‌نرد بالکن' }, blurb: { en: 'Two boards, one balcony, no doubling before noon.', fa: 'دو تخته، یک بالکن، قبل از ظهر دوبل ممنوع.' }, crest: 'crest-cup', hue: 25, game: 'backgammon', members: ['alex', 'reza.t', 'parisa', 'farhad', 'dariush'], owner: 'reza.t', ageDays: 88 },
    { id: 'g-lunch', name: { en: 'Lunch Ludo', fa: 'منچ ناهار' }, blurb: { en: 'Twenty minutes, four colours, back to work.', fa: 'بیست دقیقه، چهار رنگ، برگشت سر کار.' }, crest: 'crest-castle', hue: 265, game: 'ludo', members: ['roya.m', 'yas', 'hamed.z', 'tara.y', 'kian16'], owner: 'roya.m', ageDays: 51 },
    { id: 'g-midnight', name: { en: 'Midnight Table', fa: 'میز نیمه‌شب' }, blurb: { en: 'Play-money poker for people who should be asleep.', fa: 'پوکر با پول بازی، برای کسانی که باید خواب باشند.' }, crest: 'crest-moon', hue: 220, game: 'poker', members: ['nima.f', 'omid.j', 'nilou', 'sina.g', 'alex'], owner: 'omid.j', ageDays: 33 },
    { id: 'g-newcomers', name: { en: 'Newcomers’ Table', fa: 'میز تازه‌واردها' }, blurb: { en: 'Learn Hokm without anyone sighing.', fa: 'حکم یاد بگیر بدون این‌که کسی آه بکشد.' }, crest: 'crest-sprout', hue: 150, game: null, members: ['elham.b', 'shirin', 'maya.c', 'leila.a'], owner: 'leila.a', ageDays: 12 }
];
