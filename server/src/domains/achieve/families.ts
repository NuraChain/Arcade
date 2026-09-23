import { dense, linear, rungsOf, type Family, type Pace, type Rung } from './ladders.ts';

interface Name
{
    en: string;
    fa: string;
}

interface Sizes
{
    played: number;
    won: number;
    xp: number;
    rating: number;
    streak: number;
    days: number;
}

const SEAT_WORD: Readonly<Record<number, Name>> = {
    2: { en: 'two-player', fa: 'دونفره‌ی' },
    3: { en: 'three-player', fa: 'سه‌نفره‌ی' },
    4: { en: 'four-player', fa: 'چهارنفره‌ی' },
    6: { en: 'six-player', fa: 'شش‌نفره‌ی' },
    9: { en: 'nine-player', fa: 'نُه‌نفره‌ی' }
};

const SEAT_TITLE: Readonly<Record<number, { won: Name; played: Name; icon: string }>> = {
    2: { won: { en: 'Duelist', fa: 'دوئل‌کار' }, played: { en: 'Head to head', fa: 'رو در رو' }, icon: 'versus' },
    3: { won: { en: 'Odd one out', fa: 'تک‌سوار' }, played: { en: 'Three at a table', fa: 'سه نفر سر میز' }, icon: 'target' },
    4: { won: { en: 'Full table', fa: 'میز کامل' }, played: { en: 'Company', fa: 'جمع' }, icon: 'crest-crown' },
    6: { won: { en: 'Last of six', fa: 'آخرین از شش' }, played: { en: 'Six-handed', fa: 'شش‌دست' }, icon: 'people' },
    9: { won: { en: 'Last of nine', fa: 'آخرین از نُه' }, played: { en: 'Full ring', fa: 'حلقه‌ی کامل' }, icon: 'crest-crown' }
};

const PACE_TITLE: Readonly<Record<Pace, { won: Name; played: Name; icon: string; word: Name }>> = {
    live: { won: { en: 'Quick hands', fa: 'دست تند' }, played: { en: 'Live wire', fa: 'پرانرژی' }, icon: 'zap', word: { en: 'live', fa: 'زنده‌ی' } },
    turns: { won: { en: 'Long game', fa: 'بازی بلند' }, played: { en: 'Patient', fa: 'صبور' }, icon: 'clock', word: { en: 'turn-based', fa: 'نوبتی' } }
};

function core(name: Name, sizes: Sizes): Family[]
{
    return [
        {
            id: 'played', metric: { of: 'played' }, icon: 'games', steps: dense(sizes.played),
            title: { en: 'Regular', fa: 'پای ثابت' },
            blurb: { en: `Finish {n} games of ${ name.en }.`, fa: `{n} بازی ${ name.fa } را تمام کن.` },
            one: `Finish a game of ${ name.en }.`
        },
        {
            id: 'won', metric: { of: 'won' }, icon: 'trophy', steps: dense(sizes.won),
            title: { en: 'Winner', fa: 'برنده' },
            blurb: { en: `Win {n} games of ${ name.en }.`, fa: `{n} بازی ${ name.fa } را ببر.` },
            one: `Win a game of ${ name.en }.`
        },
        {
            id: 'xp', metric: { of: 'xp' }, icon: 'sparkles', steps: dense(sizes.xp, 50),
            title: { en: 'Seasoned', fa: 'کارکشته' },
            blurb: { en: `Earn {n} XP in ${ name.en }.`, fa: `در ${ name.fa } {n} امتیاز تجربه بگیر.` }
        },
        {
            id: 'rating', metric: { of: 'peak' }, icon: 'medal', steps: linear(1225, 25, sizes.rating),
            title: { en: 'Contender', fa: 'مدعی' },
            blurb: { en: `Reach a ${ name.en } rating of {n}.`, fa: `به امتیاز {n} در ${ name.fa } برس.` }
        },
        {
            id: 'streak', metric: { of: 'streak' }, icon: 'flame', steps: linear(2, 1, sizes.streak),
            title: { en: 'On fire', fa: 'داغ' },
            blurb: { en: `Win {n} games of ${ name.en } in a row.`, fa: `{n} بازی ${ name.fa } را پشت سر هم ببر.` }
        },
        {
            id: 'days', metric: { of: 'days' }, icon: 'history', steps: dense(sizes.days),
            title: { en: 'Devoted', fa: 'پایبند' },
            blurb: { en: `Play ${ name.en } on {n} different days.`, fa: `در {n} روز متفاوت ${ name.fa } بازی کن.` },
            one: `Play ${ name.en } for a day.`
        }
    ];
}

function bySeats(name: Name, seats: readonly number[], won: number, played: number): Family[]
{
    return seats.flatMap((count): Family[] => [
        {
            id: `won-${ count }`, metric: { of: 'wonAt', seats: count }, icon: SEAT_TITLE[count].icon, steps: dense(won),
            title: SEAT_TITLE[count].won,
            blurb: { en: `Win {n} ${ SEAT_WORD[count].en } games of ${ name.en }.`, fa: `{n} بازی ${ SEAT_WORD[count].fa } ${ name.fa } را ببر.` },
            one: `Win a ${ SEAT_WORD[count].en } game of ${ name.en }.`
        },
        {
            id: `played-${ count }`, metric: { of: 'playedAt', seats: count }, icon: SEAT_TITLE[count].icon, steps: dense(played),
            title: SEAT_TITLE[count].played,
            blurb: { en: `Finish {n} ${ SEAT_WORD[count].en } games of ${ name.en }.`, fa: `{n} بازی ${ SEAT_WORD[count].fa } ${ name.fa } را تمام کن.` },
            one: `Finish a ${ SEAT_WORD[count].en } game of ${ name.en }.`
        }
    ]);
}

function byPace(name: Name, won: number, played: number): Family[]
{
    return (['live', 'turns'] as const).flatMap((pace): Family[] => [
        {
            id: `won-${ pace }`, metric: { of: 'wonIn', pace }, icon: PACE_TITLE[pace].icon, steps: dense(won),
            title: PACE_TITLE[pace].won,
            blurb: { en: `Win {n} ${ PACE_TITLE[pace].word.en } games of ${ name.en }.`, fa: `{n} بازی ${ PACE_TITLE[pace].word.fa } ${ name.fa } را ببر.` },
            one: `Win a ${ PACE_TITLE[pace].word.en } game of ${ name.en }.`
        },
        {
            id: `played-${ pace }`, metric: { of: 'playedIn', pace }, icon: PACE_TITLE[pace].icon, steps: dense(played),
            title: PACE_TITLE[pace].played,
            blurb: { en: `Finish {n} ${ PACE_TITLE[pace].word.en } games of ${ name.en }.`, fa: `{n} بازی ${ PACE_TITLE[pace].word.fa } ${ name.fa } را تمام کن.` },
            one: `Finish a ${ PACE_TITLE[pace].word.en } game of ${ name.en }.`
        }
    ]);
}

const tally = (id: string, name: string, icon: string, steps: number[], title: Name, blurb: Name, one?: string): Family =>
    ({ id, metric: { of: 'tally', name }, icon, steps, title, blurb, ...(one === undefined ? {} : { one }) });

const LUDO_NAME: Name = { en: 'Ludo', fa: 'منچ' };

const LUDO: Family[] = [
    ...core(LUDO_NAME, { played: 70, won: 70, xp: 70, rating: 50, streak: 30, days: 50 }),
    ...bySeats(LUDO_NAME, [2, 3, 4], 40, 30),
    ...byPace(LUDO_NAME, 40, 30),
    tally('rolls', 'rolls', 'dice', dense(60, 10), { en: 'Roller', fa: 'تاس‌انداز' },
        { en: 'Roll the die {n} times in Ludo.', fa: 'در منچ {n} بار تاس بریز.' }),
    tally('sixes', 'sixes', 'dice', dense(60, 2), { en: 'Lucky six', fa: 'شش خوش‌شانس' },
        { en: 'Roll {n} sixes in Ludo.', fa: 'در منچ {n} بار شش بیاور.' }),
    tally('captures', 'captures', 'target', dense(70), { en: 'Hunter', fa: 'شکارچی' },
        { en: 'Send {n} tokens back to their yard in Ludo.', fa: 'در منچ {n} مهره را به خانه‌شان برگردان.' }, 'Send a token back to its yard in Ludo.'),
    tally('home', 'home', 'home', dense(70, 2), { en: 'Homecoming', fa: 'بازگشت به خانه' },
        { en: 'Bring {n} tokens home in Ludo.', fa: 'در منچ {n} مهره را به خانه برسان.' }),
    tally('enters', 'enters', 'play', dense(50, 2), { en: 'Out of the gate', fa: 'از در بیرون' },
        { en: 'Bring {n} tokens out of the yard in Ludo.', fa: 'در منچ {n} مهره را از خانه بیرون بیاور.' })
];

const HOKM_NAME: Name = { en: 'Hokm', fa: 'حکم' };

const HOKM: Family[] = [
    ...core(HOKM_NAME, { played: 70, won: 70, xp: 70, rating: 50, streak: 30, days: 60 }),
    ...bySeats(HOKM_NAME, [2, 3, 4], 40, 30),
    ...byPace(HOKM_NAME, 40, 30),
    tally('hands', 'hands', 'cards', dense(70), { en: 'Hand taker', fa: 'دست‌بَر' },
        { en: 'Take {n} hands of Hokm.', fa: '{n} دست حکم را ببر.' }, 'Take a hand of Hokm.'),
    tally('tricks', 'tricks', 'suit-spades', dense(100, 5), { en: 'Trick taker', fa: 'دست‌گیر' },
        { en: 'Take {n} tricks in Hokm.', fa: 'در حکم {n} دست بگیر.' }),
    tally('kots', 'kots', 'sparkles', dense(60), { en: 'Sweeper', fa: 'کُت‌زن' },
        { en: 'Take every trick of a hand {n} times in Hokm.', fa: 'در حکم {n} بار همه‌ی دست‌های یک حکم را بگیر.' }, 'Take every trick of a hand in Hokm.'),
    tally('trumps', 'trumps', 'crest-crown', dense(70), { en: 'Hakem', fa: 'حاکم' },
        { en: 'Name trump {n} times in Hokm.', fa: 'در حکم {n} بار حکم تعیین کن.' }, 'Name trump in Hokm.')
];

const BACKGAMMON_NAME: Name = { en: 'Backgammon', fa: 'تخته‌نرد' };

const BACKGAMMON: Family[] = [
    ...core(BACKGAMMON_NAME, { played: 80, won: 80, xp: 70, rating: 60, streak: 40, days: 60 }),
    ...byPace(BACKGAMMON_NAME, 50, 40),
    tally('games', 'games', 'trophy', dense(90), { en: 'Game winner', fa: 'دست‌بَر' },
        { en: 'Win {n} games inside Backgammon matches.', fa: 'در مسابقه‌های تخته‌نرد {n} دست ببر.' }, 'Win a game inside a Backgammon match.'),
    tally('gammons', 'gammons', 'flame', dense(80), { en: 'Gammon', fa: 'مارس' },
        { en: 'Win {n} gammons in Backgammon.', fa: 'در تخته‌نرد {n} بار مارس کن.' }, 'Win a gammon in Backgammon.'),
    tally('backgammons', 'backgammons', 'crest-crown', dense(60), { en: 'Backgammon!', fa: 'مارس ترکی' },
        { en: 'Win {n} backgammons in Backgammon.', fa: 'در تخته‌نرد {n} بار مارس ترکی کن.' }, 'Win a backgammon in Backgammon.'),
    tally('hits', 'hits', 'target', dense(100, 2), { en: 'Hitter', fa: 'زننده' },
        { en: 'Hit {n} blots in Backgammon.', fa: 'در تخته‌نرد {n} مهره‌ی تنها را بزن.' }),
    tally('borne-off', 'borneOff', 'home', dense(100, 5), { en: 'Bearing off', fa: 'جمع‌کن' },
        { en: 'Bear off {n} checkers in Backgammon.', fa: 'در تخته‌نرد {n} مهره را جمع کن.' })
];

const POKER_NAME: Name = { en: 'Poker', fa: 'پوکر' };

const POKER: Family[] = [
    ...core(POKER_NAME, { played: 80, won: 80, xp: 70, rating: 60, streak: 40, days: 60 }),
    ...bySeats(POKER_NAME, [2, 6, 9], 50, 40),
    tally('hands', 'hands', 'cards', dense(100, 5), { en: 'Grinder', fa: 'پرکار' },
        { en: 'Play {n} hands of Poker.', fa: '{n} دست پوکر بازی کن.' }),
    tally('pots', 'pots', 'coins', dense(100), { en: 'Pot taker', fa: 'پات‌بَر' },
        { en: 'Win {n} pots in Poker.', fa: 'در پوکر {n} پات ببر.' }, 'Win a pot in Poker.'),
    tally('showdowns', 'showdowns', 'cards', dense(70), { en: 'Showdown', fa: 'شودان' },
        { en: 'Go to showdown {n} times in Poker.', fa: 'در پوکر {n} بار به شودان برس.' }, 'Go to showdown in Poker.'),
    tally('knockouts', 'knockouts', 'target', dense(70), { en: 'Knockout', fa: 'حذف‌کن' },
        { en: 'Knock {n} players out of Poker games.', fa: 'در پوکر {n} بازیکن را حذف کن.' }, 'Knock a player out of a Poker game.')
];

const GLOBAL: Family[] = [
    {
        id: 'played', metric: { of: 'global', name: 'played' }, icon: 'games', steps: dense(100),
        title: { en: 'Table regular', fa: 'مهمان همیشگی' },
        blurb: { en: 'Finish {n} games of anything.', fa: '{n} بازی از هر نوعی را تمام کن.' },
        one: 'Finish a game of anything.'
    },
    {
        id: 'won', metric: { of: 'global', name: 'won' }, icon: 'trophy', steps: dense(100),
        title: { en: 'Champion', fa: 'قهرمان' },
        blurb: { en: 'Win {n} games of anything.', fa: '{n} بازی از هر نوعی را ببر.' },
        one: 'Win a game of anything.'
    },
    {
        id: 'xp', metric: { of: 'global', name: 'xp' }, icon: 'sparkles', steps: dense(100, 50),
        title: { en: 'Experienced', fa: 'باتجربه' },
        blurb: { en: 'Earn {n} XP across every game.', fa: 'در همه‌ی بازی‌ها روی هم {n} امتیاز تجربه بگیر.' }
    },
    {
        id: 'level', metric: { of: 'global', name: 'level' }, icon: 'star', steps: linear(2, 1, 60),
        title: { en: 'Level up', fa: 'بالا رفتن' },
        blurb: { en: 'Reach level {n}.', fa: 'به سطح {n} برس.' }
    },
    {
        id: 'days', metric: { of: 'global', name: 'days' }, icon: 'history', steps: dense(100),
        title: { en: 'Faithful', fa: 'وفادار' },
        blurb: { en: 'Play on {n} different days.', fa: 'در {n} روز متفاوت بازی کن.' },
        one: 'Play for a day.'
    },
    {
        id: 'hosted', metric: { of: 'global', name: 'hosted' }, icon: 'invite', steps: dense(80),
        title: { en: 'Host', fa: 'میزبان' },
        blurb: { en: 'Host {n} tables that were played to the end.', fa: 'میزبان {n} میزی باش که بازی‌اش تا آخر رفت.' },
        one: 'Host a table that was played to the end.'
    },
    {
        id: 'opponents', metric: { of: 'global', name: 'opponents' }, icon: 'people', steps: dense(100),
        title: { en: 'Well met', fa: 'آشنای همه' },
        blurb: { en: 'Play against {n} different people.', fa: 'با {n} نفر متفاوت بازی کن.' },
        one: 'Play against somebody.'
    },
    {
        id: 'won-live', metric: { of: 'global', name: 'wonLive' }, icon: 'zap', steps: dense(60),
        title: { en: 'Quick draw', fa: 'تیزدست' },
        blurb: { en: 'Win {n} live games of anything.', fa: '{n} بازی زنده از هر نوعی را ببر.' },
        one: 'Win a live game of anything.'
    },
    {
        id: 'won-duel', metric: { of: 'global', name: 'wonDuel' }, icon: 'versus', steps: dense(40),
        title: { en: 'Duel master', fa: 'استاد دوئل' },
        blurb: { en: 'Win {n} two-player games of anything.', fa: '{n} بازی دونفره از هر نوعی را ببر.' },
        one: 'Win a two-player game of anything.'
    },
    {
        id: 'rating', metric: { of: 'global', name: 'peak' }, icon: 'medal', steps: linear(1225, 25, 60),
        title: { en: 'Rated', fa: 'صاحب‌رتبه' },
        blurb: { en: 'Reach a rating of {n} in any game.', fa: 'در هر بازی‌ای به امتیاز {n} برس.' }
    },
    {
        id: 'streak', metric: { of: 'global', name: 'streak' }, icon: 'flame', steps: linear(2, 1, 40),
        title: { en: 'Streak', fa: 'پشت سر هم' },
        blurb: { en: 'Win {n} games in a row in any game.', fa: 'در هر بازی‌ای {n} برد پشت سر هم بگیر.' }
    },
    {
        id: 'won-full', metric: { of: 'global', name: 'wonFull' }, icon: 'crest-crown', steps: dense(80),
        title: { en: 'Head of the table', fa: 'صدرنشین' },
        blurb: { en: 'Win {n} games at a table of four or more.', fa: '{n} بازی سر میزی با چهار نفر یا بیشتر را ببر.' },
        one: 'Win a game at a table of four or more.'
    },
    {
        id: 'won-turns', metric: { of: 'global', name: 'wonTurns' }, icon: 'clock', steps: dense(80),
        title: { en: 'Slow and steady', fa: 'آرام و پیوسته' },
        blurb: { en: 'Win {n} turn-based games of anything.', fa: '{n} بازی نوبتی از هر نوعی را ببر.' },
        one: 'Win a turn-based game of anything.'
    }
];

export const GAME_FAMILIES: Readonly<Record<string, readonly Family[]>> = {
    ludo: LUDO,
    hokm: HOKM,
    backgammon: BACKGAMMON,
    poker: POKER
};

export const GLOBAL_FAMILIES: readonly Family[] = GLOBAL;

export const RUNGS: readonly Rung[] = [
    ...rungsOf(null, GLOBAL),
    ...Object.entries(GAME_FAMILIES).flatMap(([game, families]) => rungsOf(game, families))
];

export const familiesOf = (game: string | null): readonly Family[] => (game === null ? GLOBAL_FAMILIES : GAME_FAMILIES[game] ?? []);
