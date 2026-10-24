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
    2: { won: { en: 'Duelist', fa: 'دوئل‌باز' }, played: { en: 'Head to head', fa: 'رو در رو' }, icon: 'versus' },
    3: { won: { en: 'Odd one out', fa: 'تک‌سوار' }, played: { en: 'Three at a table', fa: 'سه نفر سر میز' }, icon: 'target' },
    4: { won: { en: 'Full table', fa: 'میز کامل' }, played: { en: 'Company', fa: 'دورهمی' }, icon: 'crest-crown' },
    6: { won: { en: 'Last of six', fa: 'آخرین نفر از شش' }, played: { en: 'Six-handed', fa: 'شش‌نفره' }, icon: 'people' },
    9: { won: { en: 'Last of nine', fa: 'آخرین نفر از نُه' }, played: { en: 'Full ring', fa: 'حلقه‌ی کامل' }, icon: 'crest-crown' }
};

const PACE_TITLE: Readonly<Record<Pace, { won: Name; played: Name; icon: string; word: Name }>> = {
    live: { won: { en: 'Quick hands', fa: 'دست تند' }, played: { en: 'Live wire', fa: 'پرانرژی' }, icon: 'zap', word: { en: 'live', fa: 'زنده‌ی' } },
    turns: { won: { en: 'Long game', fa: 'نفس‌دار' }, played: { en: 'Patient', fa: 'صبور' }, icon: 'clock', word: { en: 'turn-based', fa: 'نوبتی' } }
};

function core(name: Name, sizes: Sizes): Family[]
{
    return [
        {
            id: 'played', metric: { of: 'played' }, icon: 'games', steps: dense(sizes.played),
            title: { en: 'Regular', fa: 'پای ثابت' },
            blurb: { en: `Finish {n} games of ${ name.en }.`, fa: `{n} بازی ${ name.fa } رو تموم کن.` },
            one: `Finish a game of ${ name.en }.`
        },
        {
            id: 'won', metric: { of: 'won' }, icon: 'trophy', steps: dense(sizes.won),
            title: { en: 'Winner', fa: 'برنده' },
            blurb: { en: `Win {n} games of ${ name.en }.`, fa: `{n} بازی ${ name.fa } رو ببر.` },
            one: `Win a game of ${ name.en }.`
        },
        {
            id: 'xp', metric: { of: 'xp' }, icon: 'sparkles', steps: dense(sizes.xp, 50),
            title: { en: 'Seasoned', fa: 'کارکشته' },
            blurb: { en: `Earn {n} XP in ${ name.en }.`, fa: `توی ${ name.fa } {n} امتیاز تجربه بگیر.` }
        },
        {
            id: 'rating', metric: { of: 'peak' }, icon: 'medal', steps: linear(1225, 25, sizes.rating),
            title: { en: 'Contender', fa: 'مدعی' },
            blurb: { en: `Reach a ${ name.en } rating of {n}.`, fa: `توی ${ name.fa } به ریتینگ {n} برس.` }
        },
        {
            id: 'streak', metric: { of: 'streak' }, icon: 'flame', steps: linear(2, 1, sizes.streak),
            title: { en: 'On fire', fa: 'داغ' },
            blurb: { en: `Win {n} games of ${ name.en } in a row.`, fa: `{n} بازی ${ name.fa } رو پشت سر هم ببر.` }
        },
        {
            id: 'days', metric: { of: 'days' }, icon: 'history', steps: dense(sizes.days),
            title: { en: 'Devoted', fa: 'پایبند' },
            blurb: { en: `Play ${ name.en } on {n} different days.`, fa: `توی {n} روز مختلف ${ name.fa } بازی کن.` },
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
            blurb: { en: `Win {n} ${ SEAT_WORD[count].en } games of ${ name.en }.`, fa: `{n} بازی ${ SEAT_WORD[count].fa } ${ name.fa } رو ببر.` },
            one: `Win a ${ SEAT_WORD[count].en } game of ${ name.en }.`
        },
        {
            id: `played-${ count }`, metric: { of: 'playedAt', seats: count }, icon: SEAT_TITLE[count].icon, steps: dense(played),
            title: SEAT_TITLE[count].played,
            blurb: { en: `Finish {n} ${ SEAT_WORD[count].en } games of ${ name.en }.`, fa: `{n} بازی ${ SEAT_WORD[count].fa } ${ name.fa } رو تموم کن.` },
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
            blurb: { en: `Win {n} ${ PACE_TITLE[pace].word.en } games of ${ name.en }.`, fa: `{n} بازی ${ PACE_TITLE[pace].word.fa } ${ name.fa } رو ببر.` },
            one: `Win a ${ PACE_TITLE[pace].word.en } game of ${ name.en }.`
        },
        {
            id: `played-${ pace }`, metric: { of: 'playedIn', pace }, icon: PACE_TITLE[pace].icon, steps: dense(played),
            title: PACE_TITLE[pace].played,
            blurb: { en: `Finish {n} ${ PACE_TITLE[pace].word.en } games of ${ name.en }.`, fa: `{n} بازی ${ PACE_TITLE[pace].word.fa } ${ name.fa } رو تموم کن.` },
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
        { en: 'Roll the die {n} times in Ludo.', fa: 'توی منچ {n} بار تاس بریز.' }),
    tally('sixes', 'sixes', 'dice', dense(60, 2), { en: 'Lucky six', fa: 'شش خوش‌شانس' },
        { en: 'Roll {n} sixes in Ludo.', fa: 'توی منچ {n} بار شش بیار.' }),
    tally('captures', 'captures', 'target', dense(70), { en: 'Hunter', fa: 'شکارچی' },
        { en: 'Send {n} tokens back to their yard in Ludo.', fa: 'توی منچ {n} مهره‌ی حریف رو بزن.' }, 'Send a token back to its yard in Ludo.'),
    tally('home', 'home', 'home', dense(70, 2), { en: 'Homecoming', fa: 'رسیدن به خونه' },
        { en: 'Bring {n} tokens home in Ludo.', fa: 'توی منچ {n} مهره رو برسون خونه.' }),
    tally('enters', 'enters', 'play', dense(50, 2), { en: 'Out of the gate', fa: 'راه افتادن' },
        { en: 'Bring {n} tokens out of the yard in Ludo.', fa: 'توی منچ {n} مهره رو وارد بازی کن.' })
];

const HOKM_NAME: Name = { en: 'Hokm', fa: 'حکم' };

const HOKM: Family[] = [
    ...core(HOKM_NAME, { played: 70, won: 70, xp: 70, rating: 50, streak: 30, days: 60 }),
    ...bySeats(HOKM_NAME, [2, 3, 4], 40, 30),
    ...byPace(HOKM_NAME, 40, 30),
    tally('hands', 'hands', 'cards', dense(70), { en: 'Hand taker', fa: 'برنده‌ی دور' },
        { en: 'Take {n} hands of Hokm.', fa: '{n} دور حکم رو ببر.' }, 'Take a hand of Hokm.'),
    tally('tricks', 'tricks', 'suit-spades', dense(100, 5), { en: 'Trick taker', fa: 'دست‌جمع‌کن' },
        { en: 'Take {n} tricks in Hokm.', fa: 'توی حکم {n} دست ببر.' }),
    tally('kots', 'kots', 'sparkles', dense(60), { en: 'Sweeper', fa: 'کُت‌زن' },
        { en: 'Take every trick of a hand {n} times in Hokm.', fa: 'توی حکم {n} بار کُت کن.' }, 'Take every trick of a hand in Hokm.'),
    tally('trumps', 'trumps', 'crest-crown', dense(70), { en: 'Hakem', fa: 'حاکم' },
        { en: 'Name trump {n} times in Hokm.', fa: 'توی حکم {n} بار حکم کن.' }, 'Name trump in Hokm.')
];

const BACKGAMMON_NAME: Name = { en: 'Backgammon', fa: 'تخته‌نرد' };

const BACKGAMMON: Family[] = [
    ...core(BACKGAMMON_NAME, { played: 80, won: 80, xp: 70, rating: 60, streak: 40, days: 60 }),
    ...byPace(BACKGAMMON_NAME, 50, 40),
    tally('games', 'games', 'trophy', dense(90), { en: 'Game winner', fa: 'برنده‌ی دست' },
        { en: 'Win {n} games inside Backgammon matches.', fa: 'توی مسابقه‌های تخته‌نرد {n} دست ببر.' }, 'Win a game inside a Backgammon match.'),
    tally('gammons', 'gammons', 'flame', dense(80), { en: 'Gammon', fa: 'مارس' },
        { en: 'Win {n} gammons in Backgammon.', fa: 'توی تخته‌نرد {n} بار مارس کن.' }, 'Win a gammon in Backgammon.'),
    tally('backgammons', 'backgammons', 'crest-crown', dense(60), { en: 'Backgammon!', fa: 'مارس ترکی' },
        { en: 'Win {n} backgammons in Backgammon.', fa: 'توی تخته‌نرد {n} بار مارس ترکی کن.' }, 'Win a backgammon in Backgammon.'),
    tally('hits', 'hits', 'target', dense(100, 2), { en: 'Hitter', fa: 'ضربه‌زن' },
        { en: 'Hit {n} blots in Backgammon.', fa: 'توی تخته‌نرد {n} مهره‌ی تنها رو بزن.' }),
    tally('borne-off', 'borneOff', 'home', dense(100, 5), { en: 'Bearing off', fa: 'جمع‌کن' },
        { en: 'Bear off {n} checkers in Backgammon.', fa: 'توی تخته‌نرد {n} مهره جمع کن.' })
];

const POKER_NAME: Name = { en: 'Poker', fa: 'پوکر' };

const POKER: Family[] = [
    ...core(POKER_NAME, { played: 80, won: 80, xp: 70, rating: 60, streak: 40, days: 60 }),
    ...bySeats(POKER_NAME, [2, 6, 9], 50, 40),
    tally('hands', 'hands', 'cards', dense(100, 5), { en: 'Grinder', fa: 'پرکار' },
        { en: 'Play {n} hands of Poker.', fa: '{n} دست پوکر بازی کن.' }),
    tally('pots', 'pots', 'coins', dense(100), { en: 'Pot taker', fa: 'پات‌بَر' },
        { en: 'Win {n} pots in Poker.', fa: 'توی پوکر {n} پات ببر.' }, 'Win a pot in Poker.'),
    tally('showdowns', 'showdowns', 'cards', dense(70), { en: 'Showdown', fa: 'شودان' },
        { en: 'Go to showdown {n} times in Poker.', fa: 'توی پوکر {n} بار به شودان برس.' }, 'Go to showdown in Poker.'),
    tally('knockouts', 'knockouts', 'target', dense(70), { en: 'Knockout', fa: 'حذف‌کن' },
        { en: 'Knock {n} players out of Poker games.', fa: 'توی پوکر {n} بازیکن رو حذف کن.' }, 'Knock a player out of a Poker game.')
];

const CHESS_NAME: Name = { en: 'Chess', fa: 'شطرنج' };

const CHESS: Family[] = [
    ...core(CHESS_NAME, { played: 80, won: 80, xp: 70, rating: 60, streak: 40, days: 60 }),
    ...byPace(CHESS_NAME, 50, 40),
    tally('moves', 'moves', 'play', dense(80, 10), { en: 'Mover', fa: 'حرکت‌به‌حرکت' },
        { en: 'Make {n} moves in Chess.', fa: 'توی شطرنج {n} حرکت بزن.' }),
    tally('captures', 'captures', 'target', dense(80, 2), { en: 'Collector', fa: 'مهره‌جمع‌کن' },
        { en: 'Capture {n} pieces in Chess.', fa: 'توی شطرنج {n} مهره بزن.' }),
    tally('checks', 'checks', 'zap', dense(60, 2), { en: 'Check!', fa: 'کیش!' },
        { en: 'Give check {n} times in Chess.', fa: 'توی شطرنج {n} بار کیش بده.' }),
    tally('checkmates', 'checkmates', 'crest-crown', dense(70), { en: 'Checkmate', fa: 'مات' },
        { en: 'Checkmate {n} times in Chess.', fa: 'توی شطرنج {n} بار مات کن.' }, 'Checkmate somebody in Chess.'),
    tally('castles', 'castles', 'crest-castle', dense(50), { en: 'Castle keeper', fa: 'قلعه‌نشین' },
        { en: 'Castle {n} times in Chess.', fa: 'توی شطرنج {n} بار قلعه برو.' }, 'Castle in Chess.'),
    tally('promotions', 'promotions', 'sparkles', dense(50), { en: 'Crowned', fa: 'تاج‌گذاری' },
        { en: 'Promote {n} pawns in Chess.', fa: 'توی شطرنج {n} تا سرباز رو تبدیل کن.' }, 'Promote a pawn in Chess.'),
    tally('en-passant', 'enPassants', 'forward', dense(20), { en: 'In passing', fa: 'آن‌پاسان' },
        { en: 'Take {n} pawns en passant in Chess.', fa: 'توی شطرنج {n} بار آن‌پاسان بزن.' }, 'Take a pawn en passant in Chess.'),
    tally('draws', 'draws', 'equal', dense(20), { en: 'Even match', fa: 'هم‌آورد' },
        { en: 'Draw {n} games of Chess.', fa: '{n} بازی شطرنج رو مساوی کن.' }, 'Draw a game of Chess.')
];

const GLOBAL: Family[] = [
    {
        id: 'played', metric: { of: 'global', name: 'played' }, icon: 'games', steps: dense(100),
        title: { en: 'Table regular', fa: 'پای ثابت میزها' },
        blurb: { en: 'Finish {n} games of anything.', fa: 'هر بازی‌ای که دوست داری، {n} بار تا آخر بازی کن.' },
        one: 'Finish a game of anything.'
    },
    {
        id: 'won', metric: { of: 'global', name: 'won' }, icon: 'trophy', steps: dense(100),
        title: { en: 'Champion', fa: 'قهرمان' },
        blurb: { en: 'Win {n} games of anything.', fa: 'توی هر بازی‌ای که دوست داری، {n} بار ببر.' },
        one: 'Win a game of anything.'
    },
    {
        id: 'xp', metric: { of: 'global', name: 'xp' }, icon: 'sparkles', steps: dense(100, 50),
        title: { en: 'Experienced', fa: 'باتجربه' },
        blurb: { en: 'Earn {n} XP across every game.', fa: 'توی همه‌ی بازی‌ها روی هم {n} امتیاز تجربه بگیر.' }
    },
    {
        id: 'level', metric: { of: 'global', name: 'level' }, icon: 'star', steps: linear(2, 1, 60),
        title: { en: 'Level up', fa: 'پله‌پله' },
        blurb: { en: 'Reach level {n}.', fa: 'به سطح {n} برس.' }
    },
    {
        id: 'days', metric: { of: 'global', name: 'days' }, icon: 'history', steps: dense(100),
        title: { en: 'Faithful', fa: 'وفادار' },
        blurb: { en: 'Play on {n} different days.', fa: 'توی {n} روز مختلف بازی کن.' },
        one: 'Play for a day.'
    },
    {
        id: 'hosted', metric: { of: 'global', name: 'hosted' }, icon: 'invite', steps: dense(80),
        title: { en: 'Host', fa: 'میزبان' },
        blurb: { en: 'Host {n} tables that were played to the end.', fa: 'میزبان {n} میزی باش که بازیش تا آخر رفت.' },
        one: 'Host a table that was played to the end.'
    },
    {
        id: 'opponents', metric: { of: 'global', name: 'opponents' }, icon: 'people', steps: dense(100),
        title: { en: 'Well met', fa: 'آشنای همه' },
        blurb: { en: 'Play against {n} different people.', fa: 'با {n} نفر مختلف بازی کن.' },
        one: 'Play against somebody.'
    },
    {
        id: 'won-live', metric: { of: 'global', name: 'wonLive' }, icon: 'zap', steps: dense(60),
        title: { en: 'Quick draw', fa: 'تیزدست' },
        blurb: { en: 'Win {n} live games of anything.', fa: 'توی بازی‌های زنده، هر کدوم که باشه، {n} بار ببر.' },
        one: 'Win a live game of anything.'
    },
    {
        id: 'won-duel', metric: { of: 'global', name: 'wonDuel' }, icon: 'versus', steps: dense(40),
        title: { en: 'Duel master', fa: 'استاد دوئل' },
        blurb: { en: 'Win {n} two-player games of anything.', fa: 'توی بازی‌های دونفره، هر کدوم که باشه، {n} بار ببر.' },
        one: 'Win a two-player game of anything.'
    },
    {
        id: 'rating', metric: { of: 'global', name: 'peak' }, icon: 'medal', steps: linear(1225, 25, 60),
        title: { en: 'Rated', fa: 'صاحب‌رتبه' },
        blurb: { en: 'Reach a rating of {n} in any game.', fa: 'توی هر بازی‌ای که باشه، به ریتینگ {n} برس.' }
    },
    {
        id: 'streak', metric: { of: 'global', name: 'streak' }, icon: 'flame', steps: linear(2, 1, 40),
        title: { en: 'Streak', fa: 'پشت سر هم' },
        blurb: { en: 'Win {n} games in a row in any game.', fa: 'توی هر بازی‌ای که باشه، {n} بار پشت سر هم ببر.' }
    },
    {
        id: 'won-full', metric: { of: 'global', name: 'wonFull' }, icon: 'crest-crown', steps: dense(80),
        title: { en: 'Head of the table', fa: 'صدرنشین' },
        blurb: { en: 'Win {n} games at a table of four or more.', fa: 'سر میزهای چهارنفره یا بیشتر، {n} بار ببر.' },
        one: 'Win a game at a table of four or more.'
    },
    {
        id: 'won-turns', metric: { of: 'global', name: 'wonTurns' }, icon: 'clock', steps: dense(65),
        title: { en: 'Slow and steady', fa: 'آهسته و پیوسته' },
        blurb: { en: 'Win {n} turn-based games of anything.', fa: 'توی بازی‌های نوبتی، هر کدوم که باشه، {n} بار ببر.' },
        one: 'Win a turn-based game of anything.'
    },
    {
        id: 'invited', metric: { of: 'global', name: 'invited' }, icon: 'invite', steps: [1, 2, 3, 5, 7, 10, 15, 20, 25, 35, 50, 75, 100, 150, 250],
        title: { en: 'Bring friends', fa: 'رفیق‌آور' },
        blurb: { en: 'Bring {n} people in with your link who then play a game.', fa: '{n} نفر رو با لینکت بیار که یه بازی هم بکنن.' },
        one: 'Bring somebody in with your link who then plays a game.'
    }
];

export const GAME_FAMILIES: Readonly<Record<string, readonly Family[]>> = {
    ludo: LUDO,
    hokm: HOKM,
    backgammon: BACKGAMMON,
    poker: POKER,
    chess: CHESS
};

export const GLOBAL_FAMILIES: readonly Family[] = GLOBAL;

export const RUNGS: readonly Rung[] = [
    ...rungsOf(null, GLOBAL),
    ...Object.entries(GAME_FAMILIES).flatMap(([game, families]) => rungsOf(game, families))
];

export const familiesOf = (game: string | null): readonly Family[] => (game === null ? GLOBAL_FAMILIES : GAME_FAMILIES[game] ?? []);
