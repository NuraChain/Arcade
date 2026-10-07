import type { GameId } from '../data/games.ts';
import { formatsOf, type TableRules } from '../data/tables.ts';
import { useSettings } from '../stores/settings.store.ts';
import { cubeLive } from '../../../backend/src/domains/match/backgammon/cube.ts';
import type { QuickAsk } from '../../../backend/src/domains/table/quick.ts';

export type { QuickAsk };

const BLINDS = ['low', 'mid', 'high'] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

const kept = () =>
{
    const held: unknown = useSettings().settings().quickAsks;

    return isRecord(held) ? held : {};
};

export function cubeAsked(ask: Pick<QuickAsk, 'target'>, rules: Pick<TableRules, 'hasCube'>)
{
    return rules.hasCube && (ask.target === undefined || cubeLive(ask.target, true));
}

export function fitted(held: Record<string, unknown>, rules: TableRules): QuickAsk
{
    const format = formatsOf(rules).find((one) => one.seats === held.seats && one.teams === held.teams);
    const mode = rules.modes.find((one) => one === held.mode);
    const target = rules.targets.find((one) => one === held.target);
    const blinds = rules.hasBlinds ? BLINDS.find((one) => one === held.blinds) : undefined;
    const aimed = target === undefined ? {} : { target };

    return {
        ...(format === undefined ? {} : { seats: format.seats, teams: format.teams }),
        ...(mode === undefined ? {} : { mode }),
        ...aimed,
        ...(typeof held.cube === 'boolean' && cubeAsked(aimed, rules) ? { cube: held.cube } : {}),
        ...(blinds === undefined ? {} : { blinds })
    };
}

export function recallAsk(game: GameId, rules: TableRules)
{
    const held = kept()[game];

    return fitted(isRecord(held) ? held : {}, rules);
}

export function rememberAsk(game: GameId, ask: QuickAsk)
{
    useSettings().update({ quickAsks: { ...kept(), [game]: ask } });
}
