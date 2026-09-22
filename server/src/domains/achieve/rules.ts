export interface GameFacts
{
    played: number;

    won: number;

    tallies: Readonly<Record<string, number>>;
}

export interface AchievementFacts
{
    played: number;

    won: number;

    abandoned: number;

    streak: number;

    distinctDays: number;

    seated: boolean;

    hostedFull: boolean;

    crewTen: boolean;

    games: Readonly<Record<string, GameFacts>>;
}

export interface Progress
{
    have: number;

    need: number;
}

interface Rule
{
    id: string;

    game?: string;

    progress(facts: AchievementFacts): Progress;
}

const flag = (on: boolean): Progress => ({ have: on ? 1 : 0, need: 1 });

const count = (have: number, need: number): Progress => ({ have: Math.max(0, Math.min(have, need)), need });

const NONE: GameFacts = { played: 0, won: 0, tallies: {} };

const inGame = (facts: AchievementFacts, game: string): GameFacts => facts.games[game] ?? NONE;

const tally = (facts: AchievementFacts, game: string, name: string): number => inGame(facts, game).tallies[name] ?? 0;

const RULES: readonly Rule[] = [
    { id: 'first-seat', progress: (f) => flag(f.seated) },
    { id: 'first-win', progress: (f) => count(f.won, 1) },
    { id: 'regular', progress: (f) => count(f.distinctDays, 7) },
    { id: 'host', progress: (f) => flag(f.hostedFull) },
    { id: 'streak-3', progress: (f) => count(f.streak, 3) },
    { id: 'crew', progress: (f) => flag(f.crewTen) },
    { id: 'streak-7', progress: (f) => count(f.streak, 7) },
    { id: 'centurion', progress: (f) => count(f.played, 100) },
    { id: 'fair', progress: (f) => count(f.abandoned === 0 ? f.played : 0, 50) },

    { id: 'ludo-first-win', game: 'ludo', progress: (f) => count(inGame(f, 'ludo').won, 1) },
    { id: 'ludo-hunter', game: 'ludo', progress: (f) => count(tally(f, 'ludo', 'captures'), 25) },
    { id: 'ludo-homecoming', game: 'ludo', progress: (f) => count(tally(f, 'ludo', 'home'), 40) },
    { id: 'ludo-master', game: 'ludo', progress: (f) => count(inGame(f, 'ludo').won, 25) },

    { id: 'hokm-first-hand', game: 'hokm', progress: (f) => count(tally(f, 'hokm', 'hands'), 1) },
    { id: 'hokm-kot', game: 'hokm', progress: (f) => count(tally(f, 'hokm', 'kots'), 1) },
    { id: 'hokm-tricks', game: 'hokm', progress: (f) => count(tally(f, 'hokm', 'tricks'), 100) },
    { id: 'hokm-master', game: 'hokm', progress: (f) => count(inGame(f, 'hokm').won, 25) }
];

export const ACHIEVEMENT_IDS: readonly string[] = RULES.map((rule) => rule.id);

export const ACHIEVEMENT_GAME: Readonly<Record<string, string>> = Object.fromEntries(
    RULES.flatMap((rule) => rule.game === undefined ? [] : [[rule.id, rule.game]])
);

export function progressOf(facts: AchievementFacts): Map<string, Progress>
{
    return new Map(RULES.map((rule) => [rule.id, rule.progress(facts)]));
}

export function earnedBy(facts: AchievementFacts): string[]
{
    return RULES.filter((rule) =>
    {
        const { have, need } = rule.progress(facts);

        return have >= need;
    }).map((rule) => rule.id);
}
