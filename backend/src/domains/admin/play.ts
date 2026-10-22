import type { DataSource } from 'typeorm';

import { Game, Match, Table, User } from '../../entities/index.ts';
import type { AdminMatches, AdminPlay, AdminTables } from '../../schemas.ts';
import { cursorOf, keyOf, keysetAfter, olderThan, type Keyed } from './keyset.ts';
import { PLAY_PAGE, STUCK_KINDS, type MatchList, type StuckKind } from './roles.ts';
import { record, type Actor } from './staff.ts';

type Shown = AdminPlay['games'][number];

type MatchShown = AdminMatches['rows'][number];

type TableShown = AdminTables['rows'][number];

export interface Stuck
{
    since: Date;
    kind: StuckKind;
}

interface GameRow
{
    id: string;
    status: Shown['status'];
    matches: number;
    tables: number;
}

interface PlayerRow
{
    seat: number;
    handle: string;
    displayName: string;
    hue: number;
    avatar: string | null;
}

interface MatchRow extends Keyed
{
    game: string;
    code: string;
    mode: MatchShown['mode'];
    started_at: Date;
    deadline_at: Date | null;
    stake: string | null;
    players: PlayerRow[];
}

interface TableRow extends Keyed
{
    code: string;
    game: string;
    mode: TableShown['mode'];
    privacy: TableShown['privacy'];
    seats: number;
    taken: number;
    created_at: Date;
    quick: boolean;
    stake: string | null;
    host_handle: string | null;
    host_name: string | null;
    host_hue: number | null;
    host_avatar: string | null;
}

const isKind = (value: string): value is StuckKind => STUCK_KINDS.some((kind) => kind === value);

export const stuckKindOf = (reason: string): StuckKind =>
{
    const head = reason.split(':')[0] ?? '';

    return isKind(head) ? head : 'threw';
};

const face = (handle: string, displayName: string, hue: number, avatar: string | null) => ({
    handle,
    displayName,
    hue,
    ...(avatar === null ? {} : { avatar })
});

export function createPlayService(db: DataSource)
{
    return {
        async games(): Promise<Shown[]>
        {
            const rows = await db.getRepository(Game).createQueryBuilder('g')
                .select('g.id', 'id')
                .addSelect('g.status', 'status')
                .addSelect('(select count(*)::int from matches m where m.game = g.id and m.finished_at is null)', 'matches')
                .addSelect(
                    `(select count(*)::int from tables t
                       where t.game = g.id and t.status = 'open'
                         and not exists (select 1 from matches m where m.table_id = t.id and m.finished_at is null))`,
                    'tables'
                )
                .orderBy('g.sort_order', 'ASC')
                .getRawMany<GameRow>();

            return rows.map((row) => ({ game: row.id, status: row.status, matches: row.matches, tables: row.tables }));
        },

        async stillLive(ids: readonly string[]): Promise<string[]>
        {
            if (ids.length === 0)
            {
                return [];
            }

            const rows = await db.getRepository(Match).createQueryBuilder('m')
                .select('m.id', 'id')
                .where('m.id = any(cast(:ids as uuid[]))', { ids })
                .andWhere('m.finished_at is null')
                .getRawMany<{ id: string }>();

            return rows.map((row) => row.id);
        },

        async matches(list: MatchList, game: string | null, cursor: string | null, stuck: ReadonlyMap<string, Stuck>): Promise<AdminMatches>
        {
            const ids = [...stuck.keys()];

            if (list === 'stuck' && ids.length === 0)
            {
                return { rows: [] };
            }

            const after = keysetAfter(cursor);
            const query = db.getRepository(Match).createQueryBuilder('m')
                .innerJoin(Table, 't', 't.id = m.table_id')
                .select('m.id', 'id')
                .addSelect(keyOf('m.started_at'), 'at_key')
                .addSelect('m.game', 'game')
                .addSelect('t.code', 'code')
                .addSelect('t.mode', 'mode')
                .addSelect('m.started_at', 'started_at')
                .addSelect('m.deadline_at', 'deadline_at')
                .addSelect('(select k.amount::text from table_stakes k where k.table_id = m.table_id)', 'stake')
                .addSelect(
                    `(select coalesce(jsonb_agg(jsonb_build_object('seat', p.seat, 'handle', u.handle, 'displayName', u.display_name, 'hue', u.hue, 'avatar', u.avatar) order by p.seat), '[]'::jsonb)
                        from match_players p join users u on u.id = p.user_id
                       where p.match_id = m.id)`,
                    'players'
                )
                .where('m.finished_at is null');

            if (list === 'stuck')
            {
                query.andWhere('m.id = any(cast(:ids as uuid[]))', { ids });
            }

            if (game !== null)
            {
                query.andWhere('m.game = :game', { game });
            }

            if (after !== null)
            {
                query.andWhere(olderThan('m.started_at', 'm.id'), after);
            }

            const rows = await query
                .orderBy('m.started_at', 'DESC')
                .addOrderBy('m.id', 'DESC')
                .limit(PLAY_PAGE + 1)
                .getRawMany<MatchRow>();

            return {
                rows: rows.slice(0, PLAY_PAGE).map((row) =>
                {
                    const held = stuck.get(row.id);

                    return {
                        id: row.id,
                        game: row.game,
                        code: row.code,
                        mode: row.mode,
                        startedAt: row.started_at.toISOString(),
                        ...(row.deadline_at === null ? {} : { deadline: row.deadline_at.toISOString() }),
                        ...(row.stake === null ? {} : { stake: row.stake }),
                        players: row.players.map((one) => ({ seat: one.seat, ...face(one.handle, one.displayName, one.hue, one.avatar) })),
                        ...(held === undefined ? {} : { stuck: { since: held.since.toISOString(), kind: held.kind } })
                    };
                }),
                ...cursorOf(rows, PLAY_PAGE)
            };
        },

        async tables(game: string | null, cursor: string | null): Promise<AdminTables>
        {
            const after = keysetAfter(cursor);
            const query = db.getRepository(Table).createQueryBuilder('t')
                .leftJoin(User, 'h', 'h.id = t.host_id')
                .select('t.id', 'id')
                .addSelect(keyOf('t.created_at'), 'at_key')
                .addSelect('t.code', 'code')
                .addSelect('t.game', 'game')
                .addSelect('t.mode', 'mode')
                .addSelect('t.privacy', 'privacy')
                .addSelect('t.seats', 'seats')
                .addSelect('(select count(*)::int from table_seats s where s.table_id = t.id and s.user_id is not null)', 'taken')
                .addSelect('t.created_at', 'created_at')
                .addSelect('exists (select 1 from quick_tables q where q.table_id = t.id)', 'quick')
                .addSelect('(select k.amount::text from table_stakes k where k.table_id = t.id)', 'stake')
                .addSelect('h.handle', 'host_handle')
                .addSelect('h.display_name', 'host_name')
                .addSelect('h.hue', 'host_hue')
                .addSelect('h.avatar', 'host_avatar')
                .where(`t.status = 'open'`)
                .andWhere('not exists (select 1 from matches m where m.table_id = t.id and m.finished_at is null)');

            if (game !== null)
            {
                query.andWhere('t.game = :game', { game });
            }

            if (after !== null)
            {
                query.andWhere(olderThan('t.created_at', 't.id'), after);
            }

            const rows = await query
                .orderBy('t.created_at', 'DESC')
                .addOrderBy('t.id', 'DESC')
                .limit(PLAY_PAGE + 1)
                .getRawMany<TableRow>();

            return {
                rows: rows.slice(0, PLAY_PAGE).map((row) => ({
                    id: row.id,
                    code: row.code,
                    game: row.game,
                    mode: row.mode,
                    privacy: row.privacy,
                    seats: row.seats,
                    taken: row.taken,
                    ...(row.host_handle === null ? {} : { host: face(row.host_handle, row.host_name ?? row.host_handle, row.host_hue ?? 0, row.host_avatar) }),
                    at: row.created_at.toISOString(),
                    quick: row.quick,
                    ...(row.stake === null ? {} : { stake: row.stake })
                })),
                ...cursorOf(rows, PLAY_PAGE)
            };
        },

        async switchGame(actor: Actor, game: string, on: boolean, reason: string)
        {
            return await db.transaction(async (tx) =>
            {
                const held = await tx.getRepository(Game).createQueryBuilder('g')
                    .setLock('pessimistic_write')
                    .where('g.id = :game', { game })
                    .getOne();

                if (held === null || held.status === 'coming-soon')
                {
                    return null;
                }

                const to = on ? 'available' : 'disabled';

                if (held.status === to)
                {
                    return false;
                }

                await tx.getRepository(Game).update({ id: game }, { status: to });
                await record(tx, actor, { kind: 'game', reason, details: { game, from: held.status, to } });

                return true;
            });
        }
    };
}
