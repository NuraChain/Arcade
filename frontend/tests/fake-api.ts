import { ApiError, applyFieldErrors } from '@azerothjs/http/api/shared';

import { threadSize } from '../../backend/src/domains/chat/pages.ts';
import { WATCH_TAIL } from '../../backend/src/domains/match/turns.ts';
import { NOTICE_OF } from '../../backend/src/domains/notify/notices.ts';
import { PEOPLE_FOUND_MAX, SEARCH_FROM, searchNeedle } from '../../backend/src/domains/social/names.ts';
import { handleFromAddress } from '../../backend/src/domains/identity/handle.ts';
import { createParties, type Parties, type PartyWhy } from '../../backend/src/domains/party/parties.ts';
import { createRegistry } from '../../backend/src/domains/party/registry.ts';
import { PARTY_REFUSALS } from '../../backend/src/domains/party/rules.ts';
import { chairFor, quickOf, type QuickAsk } from '../../backend/src/domains/table/quick.ts';
import { TABLE_REFUSALS, type TableRefusal } from '../../backend/src/domains/table/refusals.ts';
import { guestChairs, teamsOf } from '../../backend/src/domains/table/teams.ts';
import type { VoiceScope } from '../../backend/src/domains/table/voices.ts';
import type {
    Account,
    AdminPeople,
    AdminPerson,
    AdminMatches,
    AdminPlay,
    AdminTables,
    AdminReport,
    AdminReports,
    AdminVault,
    ChainProfile,
    ChatMessage,
    ConversationDevices,
    ConversationSummary,
    Device,
    MatchHistoryEntry,
    MuteSubject,
    NftItem,
    PersonSummary,
    Privacy,
    Standing,
    StaffList,
    StaffLog,
    StakeTerms,
    TableMoney,
    VaultGames,
    VaultState,
    WalletCall
} from '../../backend/src/schemas.ts';
import { ESCROW_STATES, STAKE_LADDER } from '../../backend/src/domains/stake/policy.ts';
import { STAFF_REFUSALS, type StaffRefusal } from '../../backend/src/domains/admin/refusals.ts';
import { LOG_PAGE, may, outranks, PEOPLE_PAGE, PLAY_PAGE, REPORTS_PAGE, type Ability, type ActionKind, type ClearPart, type GrantedRole, type PeopleList, type ReportList, type ReportOutcome, type ReportStatus, type StaffRole, type SuspendCategory, type SuspendDays } from '../../backend/src/domains/admin/roles.ts';
import {
    FRIENDSHIP_FIXTURES,
    GROUP_FIXTURES,
    PEOPLE_FIXTURES,
    REQUEST_FIXTURES,
    THREAD_FIXTURES
} from './fixtures.ts';
import { accountIdOf, buildSealedFixtures } from './sealed-fixtures.ts';
import { TABLE_RULES } from '../src/data/tables.ts';
import { runtime } from '../src/lib/runtime.ts';

export type Refusal = 'challenge-unreachable' | 'challenge-busy' | 'bad-signature' | 'wallet-unreachable' | 'wallet-busy' | 'wallet-suspended' | 'chain-unreachable';

interface GroupWire
{
    id: string;
    slug: string;
    name: string;
    blurb: string;
    crest: string;
    hue: number;
    privacy: 'private' | 'public';
    game?: string;
    owner: string;
    role?: 'owner' | 'member';
    members: string[];
    memberCount: number;
    conversationId?: string;
    createdAt: string;
}

interface NotificationWire
{
    id: string;
    kind: 'friend-request' | 'friend-accepted' | 'group-added' | 'table-invite' | 'table-removed' | 'message' | 'turn';
    actor?: string;
    ref: Record<string, string>;
    count: number;
    at: string;
    read: boolean;
}

/** How many a page carries here. Small on purpose, so a paging test does not need thirty rows. */
const NOTIFY_PAGE = 3;

interface SeatWire
{
    seat: number;
    who?: string;
    invited?: string;
    ready: boolean;
    host: boolean;
}

interface TableWire
{
    id: string;
    code: string;
    game: string;
    seats: number;
    mode: 'live' | 'turns';
    privacy: 'invite' | 'room' | 'friends' | 'public';
    target: number;
    cube: boolean;
    blinds: string;
    chat: boolean;
    voice: VoiceScope;
    teams: boolean;
    status: 'open' | 'ready' | 'closed';
    host?: string;
    chairs: SeatWire[];
    taken: number;
    mine?: number;
    conversationId?: string;
    matchId?: string;
    yourTurn?: boolean;
    removed?: boolean;
    keptOut?: string[];
    quick?: boolean;
    stake?: string;
    money?: TableMoney;
    createdAt: string;
}

/**
 * The seat claim, in memory.
 *
 * The RACE is the server's business and `seat-race.spec.ts` owns it against a real Postgres.
 * What this fake exists to prove is the other half: that the client sends what it said it would,
 * renders what came back, and treats "no chair" as an answer rather than an error.
 */
function restate(table: TableWire)
{
    table.taken = table.chairs.filter((chair) => chair.who !== undefined).length;
    if (table.status !== 'closed')
    {
        table.status = table.taken >= table.seats ? 'ready' : 'open';
    }
    const mine = table.chairs.find((chair) => chair.who === server.me);
    if (mine === undefined)
    {
        delete table.mine;
        delete table.conversationId;
    }
    else
    {
        table.mine = mine.seat;
        table.conversationId = `conv-${ table.id }`;
    }
    if (keptOut(table, server.me))
    {
        table.removed = true;
    }
    else
    {
        delete table.removed;
    }

    const named = table.host === server.me && mine !== undefined
        ? (server.keptOut[table.id] ?? []).filter((who) => !server.blocks.includes(who)).reverse()
        : [];

    if (named.length > 0)
    {
        table.keptOut = named;
    }
    else
    {
        delete table.keptOut;
    }
    return table;
}

const noTable = () => new ApiError(404, 'not-found', 'No table there.', undefined);

const keptOut = (table: TableWire, who: string) => (server.keptOut[table.id] ?? []).includes(who);

function mustTable(id: string)
{
    const table = server.tables.find((one) => one.id === id);
    if (table === undefined)
    {
        throw noTable();
    }
    return table;
}

function mustSee(id: string)
{
    const table = mustTable(id);

    if (table.privacy === 'invite' && keptOut(table, server.me))
    {
        throw noTable();
    }

    return table;
}

const tableRefusal = (word: TableRefusal, message: string) => new ApiError(TABLE_REFUSALS[word], word, message, undefined);

const noInvitee = () => tableRefusal('no-invitee', 'No one by that name can be invited.');

const formParties = (): Parties => createParties({
    registry: createRegistry({
        now: () => runtime().clock.now(),
        after: (ms, run) => runtime().clock.after(ms, run),
        ring: (userIds) => server.partyRung.push(...userIds),
        id: () => crypto.randomUUID()
    }),
    person: async (handle) => (PEOPLE_FIXTURES.some((one) => one.handle === handle) ? handle : null),
    handles: async (userIds) => new Map(userIds.map((id) => [id, id])),
    reaches: async (a, b) => [a, b].every((who) => who === server.me || (!server.blocks.includes(who) && server.refusals[who] === undefined)),
    muted: async (userId, by, game) => userId === server.me && server.mutes.some((entry) =>
        (entry.kind === 'person' && entry.id === by) || (entry.kind === 'notice' && entry.id === 'invites') || (entry.kind === 'game' && entry.id === game)),
    teamGame: async (game) =>
    {
        const rules = TABLE_RULES[game as keyof typeof TABLE_RULES];

        return rules !== undefined && rules.seats.includes(4) && teamsOf(rules.partners, 4, true);
    }
});

function teamed(answer: { ok: true } | { ok: false; why: PartyWhy })
{
    if (!answer.ok)
    {
        throw answer.why === 'no-invitee' ? noInvitee() : new ApiError(PARTY_REFUSALS[answer.why], answer.why, 'That team-up was refused.', undefined);
    }
}

interface OpeningWire
{
    game: string;
    seats: number;
    mode: 'live' | 'turns';
    privacy: 'invite' | 'room' | 'friends' | 'public';
    target: number;
    cube: boolean;
    blinds: string;
    chat: boolean;
    voice: VoiceScope;
    teams: boolean;
    invitees: string[];
    stake?: string;
}

function newTable(input: OpeningWire)
{
    server.tableSeq += 1;

    const teams = teamsOf(TABLE_RULES[input.game as keyof typeof TABLE_RULES]?.partners ?? 'none', input.seats, input.teams);
    const held = guestChairs(input.seats, teams);

    const made: TableWire = {
        id: `table-${ server.tableSeq }`,
        code: `code${ server.tableSeq }`,
        game: input.game,
        seats: input.seats,
        mode: input.mode,
        privacy: input.privacy,
        target: input.target,
        cube: input.cube,
        blinds: input.blinds,
        chat: input.chat,
        voice: input.voice,
        teams,
        ...(input.stake === undefined ? {} : { stake: input.stake }),
        status: 'open',
        host: server.me,
        chairs: Array.from({ length: input.seats }, (_, seat) => ({
            seat,
            ready: false,
            host: seat === 0,
            ...(seat === 0 ? { who: server.me } : {}),
            ...(input.invitees[held.indexOf(seat)] === undefined ? {} : { invited: input.invitees[held.indexOf(seat)] })
        })),
        taken: 1,
        createdAt: new Date(0).toISOString()
    };

    server.tables.push(made);

    return made;
}

function mustGroup(slug: string)
{
    const group = server.groups.find((one) => one.slug === slug);
    if (group === undefined)
    {
        throw new ApiError(404, 'not-found', 'No group there.', undefined);
    }
    return group;
}

function mustDevice(id: string)
{
    const found = server.devices.find((one) => one.id === id);
    if (found === undefined)
    {
        throw new ApiError(404, 'not-found', 'No device there.', undefined);
    }
    return found;
}

const CHAIN_REGISTRY = '0x8CFbcEf737BE3C67A52A20Ae3DCC685ACF759460';

export const NURA_VAULT = '0x5FbDB2315678afecb367f032d93F642f64180aa3';

export const nuraState = (): VaultState => ({
    configured: true,
    vault: NURA_VAULT,
    chainId: 31337,
    fee: 500,
    maxStake: '1000000000000000000000',
    reclaimAfter: 259_200,
    paused: false,
    ladder: [...STAKE_LADDER],
    may: 'yes',
    balances: {
        address: '0x71C7656EC7ab88b098defB751B7401B5f6d8976F',
        free: '50000000000000000000',
        locked: '0',
        wallet: '20000000000000000000'
    }
});

const nuraFresh = () => ({
    state: nuraState() as VaultState,
    call: { from: '0x71C7656EC7ab88b098defB751B7401B5f6d8976F', to: NURA_VAULT, data: '0xd0e30db0', value: '0x0', chainId: 31337 } as WalletCall,
    terms: { typedData: '{"primaryType":"Stake","message":{"nonce":"0x01"}}', deadline: '2026-10-21T00:30:00.000Z' } as StakeTerms,
    games: { games: [] } as VaultGames,
    refuse: null as { status: number; code: string } | null,
    signatures: [] as (string | undefined)[]
});

export const adminState = (): AdminVault => ({
    configured: true,
    vault: NURA_VAULT,
    chainId: 31337,
    fee: 500,
    maxFee: 1000,
    maxStake: '1000000000000000000000',
    reclaimAfter: 259_200,
    paused: false,
    held: '81000000000000000000',
    free: '50000000000000000000',
    locked: '30000000000000000000',
    fees: '1000000000000000000',
    solvent: true,
    referee: { address: '0xa0Ee7A142d267C1f36714E4a8F75612F20a79720', gas: '5000000000000000000', games: '96', low: false, allowed: true },
    roles: { admin: true, pauser: true },
    playing: 3,
    states: ESCROW_STATES.map((state) => ({ state, count: state === 'open' ? 3 : state === 'settled' ? 12 : 0 })),
    stuck: []
});

const adminFresh = () => ({
    state: adminState(),
    owner: true,
    refuse: null as { status: number; code: string } | null
});

const adminRefusal = () =>
{
    if (!server.admin.owner)
    {
        throw new ApiError(404, 'not-found', 'Nothing there.', undefined);
    }

    const refused = server.admin.refuse;

    if (refused !== null)
    {
        throw new ApiError(refused.status, refused.code, refused.code, undefined);
    }
};

type StaffMember = StaffList['members'][number];

type StaffLogRow = StaffLog['rows'][number];

export const staffMember = (handle: string, role: StaffRole, grantedBy?: string, grantedAt?: string): StaffMember =>
{
    const person = personWire(handle);

    return {
        handle,
        displayName: person.displayName,
        hue: person.hue,
        role,
        ...(grantedBy === undefined ? {} : { grantedBy }),
        ...(grantedAt === undefined ? {} : { grantedAt })
    };
};

const staffFresh = () => ({
    owner: 'alex' as string | null,
    members: [] as StaffMember[],
    log: [] as StaffLogRow[],
    logged: 0
});

type PlayStatus = AdminPlay['games'][number]['status'];

const playFresh = (): AdminPlay => ({ games: ['hokm', 'poker', 'backgammon', 'ludo'].map((game) => ({ game, status: 'available' as PlayStatus, matches: 0, tables: 0 })), stuck: 0 });

const playingFresh = () => ({ matches: [] as AdminMatches['rows'], tables: [] as AdminTables['rows'], over: [] as string[] });

const pageOf = <T extends { id: string }>(rows: readonly T[], cursor: string | undefined) =>
{
    const from = cursor === undefined ? 0 : rows.findIndex((one) => one.id === cursor) + 1;
    const page = rows.slice(from, from + PLAY_PAGE);
    const last = page.at(-1);

    return { rows: structuredClone(page), ...(rows.length > from + PLAY_PAGE && last !== undefined ? { cursor: last.id } : {}) };
};

const staffRoleOf = (handle: string) => (server.staff.owner === handle ? 'owner' : server.staff.members.find((one) => one.handle === handle)?.role ?? null);

const staffRefused = (word: StaffRefusal, message: string) => new ApiError(STAFF_REFUSALS[word], word, message, undefined);

const staffGate = (ability: Ability) =>
{
    if (!may(staffRoleOf(server.me), ability))
    {
        throw new ApiError(404, 'not-found', 'Nothing there.', undefined);
    }
};

const staffListed = (): StaffList => ({
    ...(server.staff.owner === null ? {} : { owner: staffMember(server.staff.owner, 'owner') }),
    members: structuredClone(server.staff.members).sort((a, b) =>
        Number(a.role !== 'admin') - Number(b.role !== 'admin')
        || (a.grantedAt ?? '').localeCompare(b.grantedAt ?? '')
        || a.handle.localeCompare(b.handle))
});

export const staffLogged = (row: Omit<StaffLogRow, 'id'>) =>
{
    server.staff.logged += 1;
    server.staff.log.unshift({ id: `log-${ server.staff.logged }`, ...row });
};

type AdminRow = AdminPeople['rows'][number];

const accountsFresh = () => ({
    crowd: [] as string[],
    suspended: [] as string[],
    reported: {} as Record<string, number>,
    about: {} as Record<string, Partial<AdminPerson>>
});

const accountHandles = () => [server.me, ...PEOPLE_FIXTURES.map((one) => one.handle).filter((handle) => handle !== server.me), ...server.accounts.crowd];

const accountRow = (handle: string, at: number): AdminRow =>
{
    const person = personWire(handle);
    const role = staffRoleOf(handle);
    const reports = server.accounts.reported[handle] ?? 0;

    return {
        handle,
        displayName: person.displayName,
        hue: person.hue,
        createdAt: new Date(Date.parse('2026-10-20T09:00:00.000Z') - at * 3_600_000).toISOString(),
        minor: person.isMinor,
        suspended: server.accounts.suspended.includes(handle),
        ...(role === null ? {} : { staff: role }),
        reports
    };
};

const ACCOUNT_LISTS: Record<PeopleList, (row: AdminRow) => boolean> = {
    newest: () => true,
    suspended: (row) => row.suspended,
    minors: (row) => row.minor,
    staff: (row) => row.staff !== undefined,
    reported: (row) => row.reports > 0
};

const historyOf = (handle: string, cursor: string | null) =>
{
    const rows = server.staff.log.filter((row) => row.person === handle);
    const from = cursor === null ? 0 : rows.findIndex((row) => row.id === cursor) + 1;
    const page = rows.slice(from, from + LOG_PAGE);
    const last = page[page.length - 1];

    return { rows: structuredClone(page), ...(rows.length > from + LOG_PAGE && last !== undefined ? { cursor: last.id } : {}) };
};

const accountView = (handle: string): AdminPerson =>
{
    const at = accountHandles().indexOf(handle);
    const first = historyOf(handle, null);

    return {
        ...accountRow(handle, at),
        bio: '',
        strangers: true,
        shown: true,
        wallets: [],
        filed: 0,
        sessions: [],
        devices: [],
        reportsAbout: [],
        paid: {},
        history: first.rows,
        ...(first.cursor === undefined ? {} : { historyCursor: first.cursor }),
        games: [],
        paidGames: [],
        ...structuredClone(server.accounts.about[handle] ?? {})
    };
};

const reachedBy = (handle: string) =>
{
    const actor = staffRoleOf(server.me);

    if (!accountHandles().includes(handle))
    {
        throw staffRefused('staff-nobody', 'No one by that name.');
    }

    if (handle === server.me)
    {
        throw staffRefused('staff-self', 'Nobody does this to their own account.');
    }

    if (!outranks(actor, staffRoleOf(handle)))
    {
        throw staffRefused('staff-rank', 'That is above what your role may do.');
    }

    return actor ?? 'moderator';
};

interface FiledReport
{
    id: string;
    category: AdminReport['category'];
    status: ReportStatus;
    at: string;
    by: string;
    about: string;
    message?: string;
    together: AdminReport['together'];
}

const reportsFresh = () => ({ filed: [] as FiledReport[], count: 0 });

export const reportFiled = (report: Pick<FiledReport, 'at' | 'by' | 'about'> & Partial<Omit<FiledReport, 'id'>>) =>
{
    server.desk.count += 1;

    const id = `report-${ server.desk.count }`;

    server.desk.filed.push({ category: 'harassment', status: 'received', together: [], ...report, id });

    return id;
};

const reportFace = (handle: string) =>
{
    const person = personWire(handle);
    const role = staffRoleOf(handle);

    return { handle, displayName: person.displayName, hue: person.hue, ...(role === null ? {} : { staff: role }) };
};

const reportRow = (report: FiledReport): AdminReports['rows'][number] => ({
    id: report.id,
    category: report.category,
    status: report.status,
    at: report.at,
    disclosed: report.message !== undefined,
    by: reportFace(report.by),
    about: reportFace(report.about)
});

const reportView = (report: FiledReport): AdminReport => ({
    ...reportRow(report),
    ...(report.message === undefined ? {} : { message: report.message }),
    together: structuredClone(report.together),
    history: structuredClone(server.staff.log.filter((row) => row.kind === 'report' && row.details.report === report.id))
});

const waitingReports = () => server.desk.filed.filter((one) => one.status === 'received').length;

const reportNamed = (id: string) =>
{
    const found = server.desk.filed.find((one) => one.id === id);

    if (found === undefined)
    {
        throw new ApiError(404, 'not-found', 'Nothing there.', undefined);
    }

    return found;
};

const nuraRefusal = () =>
{
    const refused = server.nura.refuse;

    if (refused !== null)
    {
        throw new ApiError(refused.status, refused.code, refused.code, undefined);
    }
};

export const server =
{
    account: null as Account | null,
    issued: null as { nonce: string; message: string; address: string; device?: string } | null,
    received: null as { address: string; nonce: string; signature: string; providerRdns?: string; device?: { id: string; exchangeKey: string; signingKey: string; label: string } } | null,
    refuse: null as Refusal | null,
    suspension: {} as Record<string, string>,
    uploaded: null as string | null,
    chain: { configured: false, profile: null as ChainProfile | null },
    nfts: { configured: false, items: [] as NftItem[] },
    chainFaces: {} as Record<string, { username: string; displayName: string; bio: string; avatar: string }>,
    calls: [] as string[],
    sessions: 3,

    /** Handles `claimHandle` refuses with a 409, so the taken-name branch has something to hit. */
    takenHandles: [] as string[],

    /**
     * How busy each game is. Empty by default, which is the honest resting state for a fake: a
     * store that used to invent these numbers should not have a fake inventing them either, and a
     * spec that cares about a count says so by putting one here.
     */
    live: [] as { game: string; status?: PlayStatus; playing: number; tables: number }[],
    games: [] as unknown[],
    achievements: { scopes: [], families: [], recent: [] } as unknown,
    progress: { xp: 0, level: 1, into: 0, span: 100 },
    ladders: {} as Record<string, unknown>,

    /** A game's leaderboard. Empty by default, which is what a game nobody has played looks like. */
    standings: [] as Standing[],
    boardsAsked: [] as string[],
    history: [] as MatchHistoryEntry[],

    /** The social half: mutes the fake server holds, and the privacy it enforces. */
    mutes: [] as { kind: MuteSubject; id: string }[],
    allowStrangerMessages: true,
    showOnline: true,
    minor: false,
    refuseMute: false,

    /**
     * The chat half: the same fixtures the development server seeds, in memory.
     *
     * Sharing the fixture file with the server is the point - a test that builds its own
     * conversations proves the client agrees with the test, not with the product.
     */
    me: 'alex',
    conversations: [] as ConversationSummary[],
    messages: [] as ChatMessage[],
    refuseSend: null as string | null,

    /** How many conversations one page of the list holds; unset, the whole list is one page. */
    listPage: null as number | null,

    /**
     * The groups, from the same fixtures the development server seeds.
     *
     * Held as rows rather than built per call, because every write answers with the group as it
     * now stands and a test that joins one then reads the list has to see the same object twice.
     */
    groups: [] as GroupWire[],
    refuseGroup: null as string | null,
    tableSeq: 0,

    /**
     * Notifications, newest first.
     *
     * Written by `notify()` rather than by the routes, because what a test wants to arrange is
     * "these things have happened to me", not "the server would have written these rows".
     */
    notifications: [] as NotificationWire[],
    notifySeq: 0,

    /**
     * What `GET /chat/:id/devices` answers, per conversation id.
     *
     * Arranged by a spec rather than derived, because what a test needs to set up is "the other
     * side of this conversation looks like THIS" - including the shapes the real server would
     * never produce, which are exactly the ones the client has to survive.
     *
     * A conversation with no entry answers with no members at all, which is what an unknown id
     * would do.
     */
    conversationDevices: {} as Record<string, ConversationDevices>,

    /**
     * The epochs this fake has been asked to store, per conversation.
     *
     * It holds them exactly as the real server does - a commitment it cannot check and wrapped keys
     * it cannot open - which is what lets the browser specs run a genuine round trip: seal here,
     * store here, read back here, and open with the same code the product ships.
     */
    epochs: {} as Record<string, FakeEpoch[]>,

    /** Which device this fake is answering as, so `wrapped` is the right one's copy. */
    sealDevice: null as string | null,

    /**
     * The recovery vault, exactly as opaque here as it is on the real server.
     *
     * This fake stores four strings it cannot read and verifies nothing, because verifying a P-256
     * signature is a claim about the SERVER and belongs to `recovery.db.spec.ts` against a real
     * Postgres. What it is for is letting a page mount the store without exploding.
     */
    vault: null as { salt: string; publicKey: string; wrapped: string; checkValue: string } | null,
    nura: nuraFresh(),
    admin: adminFresh(),
    staff: staffFresh(),
    accounts: accountsFresh(),
    desk: reportsFresh(),
    play: playFresh(),
    playing: playingFresh(),

    archive: [] as { conversationId: string; epoch: number; wrapped: string }[],

    /**
     * Devices, in memory.
     *
     * This fake does NOT recompute an id from the keys. That rule belongs to the real server and
     * `device.db.spec.ts` owns it against a real Postgres; re-implementing it here would only
     * prove the fake agrees with itself, and it would make arranging a tampered row - which is a
     * state the client has to render - impossible.
     */
    devices: [] as Device[],
    currentDevice: null as string | null,
    refuseEnrol: null as 'burned' | 'unauthorized' | null,

    /** Records a device the way the server would. */
    addDevice(input: {
        exchangeKey: string;
        signingKey: string;
        label?: string;
        attested?: Device['attested'];
        revoked?: boolean;
        id: string;
    })
    {
        const device: Device = {
            id: input.id,
            label: input.label ?? '',
            exchangeKey: input.exchangeKey,
            signingKey: input.signingKey,
            attested: input.attested ?? 'wallet',
            revoked: input.revoked ?? false,
            createdAt: new Date(1_700_000_000_000 + server.devices.length * 1000).toISOString()
        };
        server.devices.push(device);
        return device;
    },

    /** The VAPID key this fake server publishes. Null means push is not configured. */
    pushKey: null as string | null,
    pushSubscriptions: [] as { endpoint: string; p256dh: string; auth: string }[],

    restartParties()
    {
        server.parties = formParties();
    },

    /**
     * Something happened to me, with the server's dedupe rule applied.
     *
     * One row per key: a second arrival bumps the count, moves it to the top and unreads it. The
     * RULE is the server's and `notify.db.spec.ts` owns it against a real Postgres; this is here
     * so a client test can arrange a list without a database.
     */
    notify(input: { kind: NotificationWire['kind']; actor?: string; ref?: Record<string, string>; dedupeKey: string })
    {
        const existing = server.notifications.find((one) => one.id === input.dedupeKey);
        if (existing !== undefined)
        {
            existing.count += 1;
            existing.read = false;
            server.notifySeq += 1;
            existing.at = new Date(server.notifySeq * 1000).toISOString();
        }
        else
        {
            server.notifySeq += 1;
            server.notifications.push({
                id: input.dedupeKey,
                kind: input.kind,
                ...(input.actor === undefined ? {} : { actor: input.actor }),
                ref: input.ref ?? {},
                count: 1,
                at: new Date(server.notifySeq * 1000).toISOString(),
                read: false
            });
        }
        server.notifications.sort((a, b) => b.at.localeCompare(a.at));
    },

    /** Tables, in memory. Empty until a test opens one - nobody is sitting anywhere on boot. */
    tables: [] as TableWire[],

    outOfGame: {} as Record<string, string[]>,
    keptOut: {} as Record<string, string[]>,

    parties: formParties(),
    partyRung: [] as string[],
    refusals: {} as Record<string, 'blocked' | 'strangers-off' | 'minor-safety'>,

    asked: [] as { game: string; seats: number; teams: boolean }[],
    sought: [] as (QuickAsk & { game: string; voice: VoiceScope; stake?: string; signature?: string })[],

    searched: [] as string[],
    directoryMax: Infinity,

    watching: [] as { id: string; code: string; game: string; seats: number; players: string[]; startedAt: string }[],

    watches: {} as Record<string, unknown>,
    ledgers: {} as Record<string, { rev: number }[]>,
    watchedFrom: [] as string[],
    proofs: {} as Record<string, unknown>,
    proofRefused: null as { status: number; code: string } | null,

    /** The graph, from the same fixtures the development server seeds. */
    friends: [] as string[],
    incoming: [] as { id: string; from: string; to: string; at: string }[],
    outgoing: [] as { id: string; from: string; to: string; at: string }[],
    blocks: [] as string[],
    reports: [] as { id: string; against: string; category: string; status: string; at: string }[],

    reset()
    {
        server.watching = [];
        server.watches = {};
        server.ledgers = {};
        server.watchedFrom = [];
        server.proofs = {};
        server.proofRefused = null;
        server.games = [];
        server.live = [];
        server.achievements = { scopes: [], families: [], recent: [] };
        server.progress = { xp: 0, level: 1, into: 0, span: 100 };
        server.ladders = {};
        server.standings = [];
        server.boardsAsked = [];
        server.history = [];
        server.groups = GROUP_FIXTURES.map((group) => ({
            id: group.slug,
            slug: group.slug,
            name: group.name,
            blurb: group.blurb,
            crest: group.crest,
            hue: group.hue,
            privacy: group.privacy,
            ...(group.game === null ? {} : { game: group.game }),
            owner: group.owner,
            members: [...group.members],
            memberCount: group.members.length,
            ...(group.members.includes('alex') ? { role: group.owner === 'alex' ? 'owner' as const : 'member' as const } : {}),
            ...(group.members.includes('alex') ? { conversationId: `conv-${ group.slug }` } : {}),
            createdAt: new Date(0).toISOString()
        }));
        server.refuseGroup = null;
        server.tables = [];
        server.outOfGame = {};
        server.keptOut = {};
        server.parties = formParties();
        server.partyRung = [];
        server.refusals = {};
        server.asked = [];
        server.sought = [];
        server.searched = [];
        server.directoryMax = Infinity;
        server.tableSeq = 0;
        server.notifications = [];
        server.notifySeq = 0;
        server.conversationDevices = {};
        server.epochs = {};
        server.sealDevice = null;
        server.vault = null;
        server.nura = nuraFresh();
        server.admin = adminFresh();
        server.staff = staffFresh();
        server.accounts = accountsFresh();
        server.desk = reportsFresh();
        server.play = playFresh();
        server.playing = playingFresh();
        server.archive = [];
        server.devices = [];
        server.currentDevice = null;
        server.refuseEnrol = null;
        server.pushKey = null;
        server.pushSubscriptions = [];
        server.account = null;
        server.issued = null;
        server.received = null;
        server.refuse = null;
        server.suspension = {};
        server.uploaded = null;
        server.chain = { configured: false, profile: null };
        server.nfts = { configured: false, items: [] };
        server.chainFaces = {};
        server.calls = [];
        server.sessions = 3;
        server.mutes = [];
        server.allowStrangerMessages = true;
        server.showOnline = true;
        server.minor = false;
        server.refuseMute = false;
        server.me = 'alex';
        server.refuseSend = null;
        server.listPage = null;
        loadFixtures();
        loadGraph();
    }
};

/**
 * Three fixture people a spec can be signed in as.
 *
 * They exist only so a test has somebody with a name, a hue and an age gate to be. The minor is
 * here because the privacy rules turn on it.
 */
const FIXTURE_ACCOUNTS: Record<string, Account> = {
    alex: { id: accountIdOf('alex'), handle: 'alex', displayName: 'Alex Morgan', bio: '', hue: 32, isMinor: false },
    'sara.k': { id: accountIdOf('sara.k'), handle: 'sara.k', displayName: 'Sara Kamali', bio: '', hue: 340, isMinor: false },
    kian16: { id: accountIdOf('kian16'), handle: 'kian16', displayName: 'Kian Nazari', bio: '', hue: 200, isMinor: true }
};

interface FakeEpoch
{
    epoch: number;
    mintedBy: string;
    recipients: string;
    signature: string;
    confirmation: string;
    keys: Record<string, { ephemeralKey: string; wrapped: string }>;
}

interface FakeMint
{
    epoch: number;
    mintedBy: string;
    recipients: string[];
    signature: string;
    confirmation: string;
    keys: { deviceId: string; ephemeralKey: string; wrapped: string }[];
}

interface FakeSend
{
    id: string;
    kind: 'text' | 'reaction';
    target?: string;
    epoch: number;
    seq: number;
    iv: string;
    body: string;
    senderDeviceId: string;
    signature: string;
    clientAt: string;
    commitment: string;
}

/**
 * The sealed fixture corpus, built once.
 *
 * Top-level await, so every spec that imports this fake gets a server whose threads are sealed the
 * way the real one's are. It costs a few milliseconds of elliptic curve per test FILE and it is
 * what stops the entire browser suite testing a wire format the product does not have.
 */
const sealed = await buildSealedFixtures();

/** The device a fixture person holds, with real keys. `setup.ts` installs it as the key store. */
export function fixtureDevice(handle: string)
{
    return sealed.devices.get(handle) ?? null;
}

let counter = 0;

/**
 * Rebuilds the in-memory chat from the shared fixtures.
 *
 * Conversation ids are the fixture slugs rather than uuids, so a test can name `c-sara` while the
 * real server hands out uuids the client treats as opaque - which is exactly what the client does
 * with either.
 */
function loadFixtures()
{
    counter = 0;
    server.conversations = [];
    server.messages = [];
    server.conversationDevices = {};
    server.epochs = {};
    server.sealDevice = sealed.devices.get(server.me)?.id ?? null;

    for (const thread of THREAD_FIXTURES)
    {
        if (!thread.members.includes(server.me))
        {
            continue;
        }

        server.messages.push(...(sealed.messages[thread.slug] ?? []).map((one) => ({ ...one })));
        server.conversationDevices[thread.slug] = sealed.members[thread.slug];
        server.epochs[thread.slug] = (sealed.epochs[thread.slug] ?? []).map((one) => ({ ...one }));

        counter = server.messages.length;

        const mine = server.messages.filter((one) => one.conversationId === thread.slug);
        const last = mine[mine.length - 1];

        server.conversations.push({
            id: thread.slug,
            kind: thread.kind,
            members: thread.members,
            pinned: thread.pinnedFor === server.me,
            unread: thread.unreadFrom,
            ...(thread.game === null ? {} : { game: thread.game }),
            ...(last === undefined ? {} : { last })
        });
    }
}

/**
 * The social graph for whoever `server.me` is, from the fixtures.
 *
 * Handles all the way through, exactly as the real wire does - there is no uuid anywhere in a
 * payload the browser sees, so a test that passes here is a test that would pass against the
 * server.
 */
function loadGraph()
{
    server.friends = FRIENDSHIP_FIXTURES
        .filter(([a, b]) => a === server.me || b === server.me)
        .map(([a, b]) => (a === server.me ? b : a));

    const asRequest = (request: { from: string; to: string; minutesAgo: number }, index: number) => ({
        id: `req-${ index }`,
        from: request.from,
        to: request.to,
        at: new Date(1_700_000_000_000 - request.minutesAgo * 60_000).toISOString()
    });

    server.incoming = REQUEST_FIXTURES.map(asRequest).filter((request) => request.to === server.me);
    server.outgoing = REQUEST_FIXTURES.map(asRequest).filter((request) => request.from === server.me);
    server.blocks = [];
    server.reports = [];
}

const reachable = (handle: string) => !server.blocks.includes(handle) && handle !== server.me;

const personWire = (handle: string): PersonSummary =>
{
    const person = PEOPLE_FIXTURES.find((one) => one.handle === handle);
    return {
        id: handle,
        handle,
        displayName: person?.displayName ?? handle,
        bio: '',
        hue: person?.hue ?? 0,
        isMinor: person?.isMinor ?? false
    };
};

loadFixtures();
loadGraph();

export function fixtureAccount(handle: string): Account | undefined
{
    return FIXTURE_ACCOUNTS[handle];
}

/**
 * A fixture account on the server, for a spec that just needs somebody signed in.
 *
 * `auth.wallet` is the only door into an account and it needs a provider, so this sets the account
 * the server would have minted - which is what the chain and NFT reads are keyed on - and hands it
 * back for `useSession().establish`.
 */
export function establishAccount(handle = 'alex', overrides: Partial<Account> = {})
{
    const account: Account = { ...(FIXTURE_ACCOUNTS[handle] ?? FIXTURE_ACCOUNTS.alex), ...overrides };
    server.account = account;
    return account;
}

export function walletAccount(address: string): Account
{
    const lower = address.toLowerCase();
    return {
        id: `u-${ lower.slice(2, 10) }`,
        handle: handleFromAddress(address),
        displayName: `${ lower.slice(0, 6) }…${ lower.slice(-4) }`,
        bio: '',
        hue: Number.parseInt(lower.slice(2, 8), 16) % 360,
        isMinor: false,
        address: lower
    };
}

export const client =
{
    admin:
    {
        async vault()
        {
            server.calls.push('admin.vault');
            adminRefusal();
            return structuredClone(server.admin.state);
        },
        async fee({ input }: { input: { bps: number } })
        {
            server.calls.push(`admin.fee ${ input.bps }`);
            adminRefusal();
            return { ...server.nura.call, data: '0xfee' };
        },
        async ceiling({ input }: { input: { amount: string } })
        {
            server.calls.push(`admin.ceiling ${ input.amount }`);
            adminRefusal();
            return { ...server.nura.call, data: '0xceiling' };
        },
        async fees({ input }: { input: { amount: string } })
        {
            server.calls.push(`admin.fees ${ input.amount }`);
            adminRefusal();
            return { ...server.nura.call, data: '0xfees' };
        },
        async pause({ input }: { input: { paused: boolean } })
        {
            server.calls.push(`admin.pause ${ input.paused }`);
            adminRefusal();
            return { ...server.nura.call, data: '0xpause' };
        },
        async staff()
        {
            server.calls.push('admin.staff');
            staffGate('staff');
            return staffListed();
        },
        async setStaff({ input }: { input: { handle: string; role: GrantedRole | 'none'; reason: string } })
        {
            server.calls.push(`admin.setStaff ${ input.handle } ${ input.role }`);
            staffGate('staff');

            const actor = staffRoleOf(server.me);
            const known = input.handle === server.me || input.handle === server.staff.owner || PEOPLE_FIXTURES.some((one) => one.handle === input.handle);

            if (!known)
            {
                throw staffRefused('staff-nobody', 'No one by that name.');
            }

            if (input.handle === server.staff.owner)
            {
                throw staffRefused('staff-owner', 'The owner is the wallet the server’s .env names, and is changed there.');
            }

            if (input.handle === server.me)
            {
                throw staffRefused('staff-self', 'Nobody changes their own role.');
            }

            const current = server.staff.members.find((one) => one.handle === input.handle)?.role ?? null;

            if ((current !== null && !outranks(actor, current)) || (input.role !== 'none' && !outranks(actor, input.role)))
            {
                throw staffRefused('staff-rank', 'That is above what your role may do.');
            }

            const at = new Date(runtime().clock.now()).toISOString();
            const entry = { at, staff: server.me, staffRole: actor ?? 'moderator', person: input.handle, reason: input.reason };

            if (input.role === 'none' && current !== null)
            {
                server.staff.members = server.staff.members.filter((one) => one.handle !== input.handle);
                staffLogged({ ...entry, kind: 'revoke', details: { from: current } });
            }
            else if (input.role !== 'none' && current === null)
            {
                server.staff.members = [...server.staff.members, staffMember(input.handle, input.role, server.me, at)];
                staffLogged({ ...entry, kind: 'grant', details: { to: input.role } });
            }
            else if (input.role !== 'none' && current !== input.role)
            {
                server.staff.members = server.staff.members.map((one) => (one.handle === input.handle ? staffMember(one.handle, input.role as GrantedRole, server.me, at) : one));
                staffLogged({ ...entry, kind: 'change', details: { from: current ?? '', to: input.role } });
            }

            return staffListed();
        },
        async log({ query }: { query: { cursor?: string; staff?: string; person?: string; kind?: ActionKind } })
        {
            server.calls.push(`admin.log ${ JSON.stringify(query) }`);
            staffGate('log');

            const matching = server.staff.log.filter((row) =>
                (query.staff === undefined || row.staff?.toLowerCase() === query.staff.toLowerCase())
                && (query.person === undefined || row.person?.toLowerCase() === query.person.toLowerCase())
                && (query.kind === undefined || row.kind === query.kind));
            const from = query.cursor === undefined ? 0 : matching.findIndex((row) => row.id === query.cursor) + 1;
            const page = matching.slice(from, from + LOG_PAGE);
            const last = page[page.length - 1];

            return {
                rows: structuredClone(page),
                ...(matching.length > from + LOG_PAGE && last !== undefined ? { cursor: last.id } : {})
            };
        },
        async people({ query }: { query: { q?: string; list?: PeopleList; cursor?: string } })
        {
            server.calls.push(`admin.people ${ JSON.stringify(query) }`);
            staffGate('people');

            const asked = (query.q ?? '').trim().toLowerCase();
            const rows = accountHandles()
                .map((handle, at) => accountRow(handle, at))
                .filter(ACCOUNT_LISTS[query.list ?? 'newest'])
                .filter((row) => asked.length < 2 || row.handle.toLowerCase().includes(asked) || row.displayName.toLowerCase().includes(asked));
            const from = query.cursor === undefined ? 0 : rows.findIndex((row) => row.handle === query.cursor) + 1;
            const page = rows.slice(from, from + PEOPLE_PAGE);
            const last = page[page.length - 1];

            return {
                rows: page,
                ...(rows.length > from + PEOPLE_PAGE && last !== undefined ? { cursor: last.handle } : {})
            };
        },
        async person({ params }: { params: { handle: string } })
        {
            server.calls.push(`admin.person ${ params.handle }`);
            staffGate('people');

            if (!accountHandles().includes(params.handle))
            {
                throw new ApiError(404, 'not-found', 'Nothing there.', undefined);
            }

            return accountView(params.handle);
        },
        async history({ params, query }: { params: { handle: string }; query: { cursor?: string } })
        {
            server.calls.push(`admin.history ${ params.handle } ${ query.cursor ?? '' }`);
            staffGate('people');

            if (!accountHandles().includes(params.handle))
            {
                throw new ApiError(404, 'not-found', 'Nothing there.', undefined);
            }

            return historyOf(params.handle, query.cursor ?? null);
        },
        async note({ params, input }: { params: { handle: string }; input: { text: string } })
        {
            server.calls.push(`admin.note ${ params.handle } ${ input.text }`);
            staffGate('people');

            const actor = reachedBy(params.handle);

            staffLogged({ at: new Date(runtime().clock.now()).toISOString(), staff: server.me, staffRole: actor, kind: 'note', person: params.handle, reason: input.text, details: {} });

            return accountView(params.handle);
        },

        async suspend({ params, input }: { params: { handle: string }; input: { days?: SuspendDays; category: SuspendCategory; reason: string } })
        {
            server.calls.push(`admin.suspend ${ params.handle } ${ JSON.stringify(input) }`);
            staffGate('people');

            const actor = reachedBy(params.handle);
            const at = runtime().clock.now();
            const until = input.days === undefined ? null : new Date(at + input.days * 86_400_000).toISOString();

            server.accounts.suspended = [...server.accounts.suspended.filter((one) => one !== params.handle), params.handle];
            server.accounts.about[params.handle] = {
                ...server.accounts.about[params.handle],
                sessions: [],
                suspension: { category: input.category, ...(until === null ? {} : { until }), since: new Date(at).toISOString() }
            };
            staffLogged({
                at: new Date(at).toISOString(),
                staff: server.me,
                staffRole: actor,
                kind: 'suspend',
                person: params.handle,
                reason: input.reason,
                details: { category: input.category, ...(until === null ? {} : { until }), ...(input.days === undefined ? {} : { days: String(input.days) }) }
            });

            return accountView(params.handle);
        },

        async lift({ params, input }: { params: { handle: string }; input: { reason: string } })
        {
            server.calls.push(`admin.lift ${ params.handle } ${ input.reason }`);
            staffGate('people');

            const actor = reachedBy(params.handle);

            if (!server.accounts.suspended.includes(params.handle))
            {
                throw staffRefused('staff-not-suspended', 'They are not suspended.');
            }

            const kept = { ...server.accounts.about[params.handle] };

            delete kept.suspension;
            server.accounts.suspended = server.accounts.suspended.filter((one) => one !== params.handle);
            server.accounts.about[params.handle] = kept;
            staffLogged({ at: new Date(runtime().clock.now()).toISOString(), staff: server.me, staffRole: actor, kind: 'lift', person: params.handle, reason: input.reason, details: {} });

            return accountView(params.handle);
        },

        async clear({ params, input }: { params: { handle: string }; input: { part: ClearPart; reason: string } })
        {
            server.calls.push(`admin.clear ${ params.handle } ${ input.part } ${ input.reason }`);
            staffGate('people');

            const actor = reachedBy(params.handle);
            const shown = accountView(params.handle);
            const was = input.part === 'name' ? shown.displayName : input.part === 'bio' ? shown.bio : shown.avatar ?? '';
            const empty = input.part === 'name' ? was === params.handle : was === '';

            if (!empty)
            {
                const kept = { ...server.accounts.about[params.handle] };

                if (input.part === 'picture')
                {
                    delete kept.avatar;
                }
                else
                {
                    Object.assign(kept, input.part === 'name' ? { displayName: params.handle } : { bio: '' });
                }

                server.accounts.about[params.handle] = kept;
                staffLogged({ at: new Date(runtime().clock.now()).toISOString(), staff: server.me, staffRole: actor, kind: 'clear', person: params.handle, reason: input.reason, details: { part: input.part, ...(input.part === 'picture' ? {} : { from: was }) } });
            }

            return accountView(params.handle);
        },

        async signOut({ params, input }: { params: { handle: string }; input: { reason: string } })
        {
            server.calls.push(`admin.signOut ${ params.handle } ${ input.reason }`);
            staffGate('people');

            const actor = reachedBy(params.handle);
            const live = accountView(params.handle).sessions.length;

            if (live > 0)
            {
                server.accounts.about[params.handle] = { ...server.accounts.about[params.handle], sessions: [] };
                staffLogged({ at: new Date(runtime().clock.now()).toISOString(), staff: server.me, staffRole: actor, kind: 'sign-out', person: params.handle, reason: input.reason, details: { sessions: String(live) } });
            }

            return accountView(params.handle);
        },

        async reports({ query }: { query: { status?: ReportList; cursor?: string } })
        {
            server.calls.push(`admin.reports ${ JSON.stringify(query) }`);
            staffGate('reports');

            const list = query.status ?? 'received';
            const rows = [...server.desk.filed]
                .filter((one) => list === 'all' || one.status === list)
                .sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id));
            const from = query.cursor === undefined ? 0 : rows.findIndex((one) => one.id === query.cursor) + 1;
            const page = rows.slice(from, from + REPORTS_PAGE);
            const last = page[page.length - 1];

            return {
                rows: page.map(reportRow),
                ...(rows.length > from + REPORTS_PAGE && last !== undefined ? { cursor: last.id } : {}),
                waiting: waitingReports()
            };
        },

        async reportsWaiting()
        {
            server.calls.push('admin.reportsWaiting');
            staffGate('reports');

            return { count: waitingReports() };
        },

        async report({ params }: { params: { id: string } })
        {
            server.calls.push(`admin.report ${ params.id }`);
            staffGate('reports');

            return reportView(reportNamed(params.id));
        },

        async review({ params, input }: { params: { id: string }; input: { outcome: ReportOutcome; reason: string } })
        {
            server.calls.push(`admin.review ${ params.id } ${ input.outcome } ${ input.reason }`);
            staffGate('reports');

            const report = reportNamed(params.id);
            const actor = reachedBy(report.about);

            if (report.status !== input.outcome)
            {
                report.status = input.outcome;
                staffLogged({ at: new Date(runtime().clock.now()).toISOString(), staff: server.me, staffRole: actor, kind: 'report', person: report.about, reason: input.reason, details: { report: report.id, outcome: input.outcome, reporter: report.by } });
            }

            return reportView(report);
        },

        async play()
        {
            server.calls.push('admin.play');
            staffGate('play');

            return structuredClone(server.play);
        },

        async switchGame({ params, input }: { params: { game: string }; input: { on: boolean; reason: string } })
        {
            server.calls.push(`admin.switchGame ${ params.game } ${ input.on } ${ input.reason }`);
            staffGate('play');

            const held = server.play.games.find((one) => one.game === params.game);

            if (held === undefined || held.status === 'coming-soon')
            {
                throw new ApiError(404, 'not-found', 'Nothing there.', undefined);
            }

            const to: PlayStatus = input.on ? 'available' : 'disabled';
            const actor = staffRoleOf(server.me);

            if (held.status !== to)
            {
                staffLogged({ at: new Date(runtime().clock.now()).toISOString(), staff: server.me, ...(actor === null ? {} : { staffRole: actor }), kind: 'game', reason: input.reason, details: { game: params.game, from: held.status, to } });
                held.status = to;
            }

            return structuredClone(server.play);
        },

        async liveMatches({ query }: { query: { list?: 'all' | 'stuck'; game?: string; cursor?: string } })
        {
            server.calls.push(`admin.liveMatches ${ JSON.stringify(query) }`);
            staffGate('play');

            const rows = server.playing.matches.filter((one) => (query.list !== 'stuck' || one.stuck !== undefined) && (query.game === undefined || one.game === query.game));

            return pageOf(rows, query.cursor);
        },

        async waitingTables({ query }: { query: { game?: string; cursor?: string } })
        {
            server.calls.push(`admin.waitingTables ${ JSON.stringify(query) }`);
            staffGate('play');

            return pageOf(server.playing.tables.filter((one) => query.game === undefined || one.game === query.game), query.cursor);
        },

        async voidMatch({ params, input }: { params: { id: string }; input: { reason: string } })
        {
            server.calls.push(`admin.voidMatch ${ params.id } ${ input.reason }`);
            staffGate('play');

            const actor = staffRoleOf(server.me);
            const held = server.playing.matches.find((one) => one.id === params.id);

            if (held === undefined && server.playing.over.includes(params.id))
            {
                throw staffRefused('staff-match-over', 'That game has already ended.');
            }

            if (held === undefined)
            {
                throw new ApiError(404, 'not-found', 'Nothing there.', undefined);
            }

            if (held.players.some((one) => one.handle === server.me))
            {
                throw staffRefused('staff-in-game', 'Nobody ends a game they are playing in.');
            }

            if (held.players.some((one) => !outranks(actor, one.staff ?? null)))
            {
                throw staffRefused('staff-rank', 'That is above what your role may do.');
            }

            server.playing.matches = server.playing.matches.filter((one) => one.id !== held.id);
            server.playing.over.push(held.id);
            server.play.games = server.play.games.map((one) => (one.game === held.game ? { ...one, matches: Math.max(0, one.matches - 1) } : one));
            server.play.stuck = Math.max(0, server.play.stuck - (held.stuck === undefined ? 0 : 1));
            staffLogged({ at: new Date(runtime().clock.now()).toISOString(), staff: server.me, ...(actor === null ? {} : { staffRole: actor }), kind: 'void', reason: input.reason, details: { match: held.id, game: held.game, table: held.code } });

            return structuredClone(server.play);
        }
    },

    vault:
    {
        async state()
        {
            server.calls.push('vault.state');
            nuraRefusal();
            return structuredClone(server.nura.state);
        },
        async accept()
        {
            server.calls.push('vault.accept');
            nuraRefusal();
            if (server.nura.state.configured)
            {
                server.nura.state = { ...server.nura.state, may: 'yes' };
            }
            return structuredClone(server.nura.state);
        },
        async rest({ input }: { input: { days: number } })
        {
            server.calls.push(`vault.rest ${ input.days }`);
            nuraRefusal();
            if (server.nura.state.configured)
            {
                server.nura.state = { ...server.nura.state, may: 'paid-break', breakUntil: '2026-10-28T00:00:00.000Z' };
            }
            return structuredClone(server.nura.state);
        },
        async deposit({ input }: { input: { amount: string } })
        {
            server.calls.push(`vault.deposit ${ input.amount }`);
            nuraRefusal();
            return { ...server.nura.call, value: `0x${ BigInt(input.amount).toString(16) }` };
        },
        async withdraw({ input }: { input: { amount: string } })
        {
            server.calls.push(`vault.withdraw ${ input.amount }`);
            nuraRefusal();
            return { ...server.nura.call, data: '0x2e1a7d4d' };
        },
        async games(input?: { query?: { cursor?: string } })
        {
            server.calls.push(`vault.games ${ input?.query?.cursor ?? '' }`);
            nuraRefusal();
            return structuredClone(server.nura.games);
        },
        async reclaim({ input }: { input: { id: string } })
        {
            server.calls.push(`vault.reclaim ${ input.id }`);
            nuraRefusal();
            return { ...server.nura.call, data: '0xreclaim' };
        }
    },

    chain:
    {
        async profile()
        {
            server.calls.push('chain.profile');
            return {
                configured: server.chain.configured,
                registry: server.chain.configured ? CHAIN_REGISTRY : '',
                chainId: '',
                record: '',
                ...(server.chain.profile === null ? {} : { profile: server.chain.profile })
            };
        },

        async publish()
        {
            server.calls.push('chain.publish');
            if (!server.chain.configured || server.account?.address === undefined)
            {
                return { calls: [] };
            }
            return { calls: [{ to: CHAIN_REGISTRY, kind: server.chain.profile === null ? 'create' as const : 'fields' as const, data: '0x5e1f' }] };
        },

        async person({ params }: { params: { handle: string } })
        {
            server.calls.push('chain.person');
            if (server.refuse === 'chain-unreachable')
            {
                throw new ApiError(500, 'internal', 'The request took too long to respond.', undefined);
            }
            const face = server.chainFaces[params.handle];
            return { configured: server.chain.configured, ...(face === undefined ? {} : { profile: { ...face } }) };
        },

        async nfts(input: { query: { offset?: string; limit?: string } })
        {
            server.calls.push('chain.nfts');
            if (server.refuse === 'chain-unreachable')
            {
                throw new ApiError(503, 'chain-unreachable', 'We could not reach the network. Try again in a moment.', undefined);
            }
            const offset = Number(input.query.offset ?? '0');
            const limit = Number(input.query.limit ?? '24');
            const held = server.account?.address === undefined ? [] : server.nfts.items;
            return {
                configured: server.nfts.configured,
                total: server.nfts.configured ? held.length : 0,
                items: server.nfts.configured ? held.slice(offset, offset + limit).map((item) => ({ ...item })) : []
            };
        }
    },

    voice:
    {
        async ice()
        {
            server.calls.push('voice.ice');
            return { servers: [] };
        }
    },

    meta:
    {
        async info()
        {
            server.calls.push('meta.info');
            return { wire: 'nura-e2ee/v1', env: 'test' };
        }
    },

    catalogue:
    {
        async games()
        {
            server.calls.push('catalogue.games');
            return { games: server.games };
        },
        async live()
        {
            server.calls.push('catalogue.live');
            const statusOf = (game: string) => (server.games as { id?: string; status?: PlayStatus }[]).find((one) => one.id === game)?.status ?? 'available';

            return { games: server.live.map((row) => ({ status: statusOf(row.game), ...row })) };
        },
        async leaderboard(input: { params: { game: string }; query?: { window?: string } })
        {
            server.calls.push('catalogue.leaderboard');
            server.boardsAsked.push(`${ input.params.game } ${ input.query?.window ?? '' }`);
            return { game: input.params.game, standings: server.standings.map((row) => ({ ...row })) };
        }
    },

    chat:
    {
        async list(request?: { query?: { cursor?: string } })
        {
            server.calls.push('chat.list');
            const all = server.conversations.map((row) => ({ ...row }));
            const from = Number(request?.query?.cursor ?? 0);
            const size = server.listPage ?? all.length;
            const page = all.slice(from, from + size);

            return from + size < all.length ? { conversations: page, cursor: String(from + size) } : { conversations: page };
        },

        async devices({ params }: { params: { id: string } })
        {
            server.calls.push('chat.devices');
            return server.conversationDevices[params.id] ?? { members: [] };
        },

        /**
         * Who could have signed here.
         *
         * Derived from the member device lists rather than kept separately, because every device a
         * spec arranges is a current one - revoked history is a DATABASE claim and belongs to
         * `peer-devices.db.spec.ts` against a real Postgres, not to a fake that would only agree
         * with itself about it.
         */
        async signers({ params }: { params: { id: string } })
        {
            server.calls.push('chat.signers');

            const answer = server.conversationDevices[params.id] ?? { members: [] };

            return {
                signers: answer.members.flatMap((member) => member.devices.map((device) => ({
                    accountId: member.accountId,
                    handle: member.handle,
                    id: device.id,
                    exchangeKey: device.exchangeKey,
                    signingKey: device.signingKey,
                    revoked: false,
                    attested: device.attested,
                    address: device.address,
                    message: device.message,
                    signature: device.signature
                })))
            };
        },

        async epoch({ params, query }: { params: { id: string }; query: { epoch?: string; device?: string } })
        {
            server.calls.push('chat.epoch');

            // The caller names its device now; the session's is only the fallback. A browser that
            // signed out and back in has no session device at all.
            const asking = query.device ?? server.sealDevice;

            const held = server.epochs[params.id] ?? [];
            const wanted = query.epoch === undefined ? null : Number(query.epoch);

            const row = wanted === null
                ? held[held.length - 1]
                : held.find((one) => one.epoch === wanted);

            const eligible = (server.conversationDevices[params.id] ?? { members: [] })
                .members.flatMap((member) => member.devices.map((device) => device.id)).sort();

            if (row === undefined)
            {
                return { nextSeq: 1, eligible, stale: eligible.length > 0 };
            }

            const wrap = asking === null ? undefined : row.keys[asking];

            const nextSeq = server.messages.filter((one) =>
                one.conversationId === params.id
                && one.epoch === row.epoch
                && one.senderDeviceId === asking).length + 1;

            return {
                epoch: row.epoch,
                mintedBy: row.mintedBy,
                recipients: row.recipients,
                signature: row.signature,
                confirmation: row.confirmation,
                ...(wrap === undefined ? {} : { wrapped: wrap }),
                nextSeq,
                eligible,
                stale: wanted === null && row.recipients !== eligible.join(',')
            };
        },

        async mint({ params, input }: { params: { id: string }; input: FakeMint })
        {
            server.calls.push('chat.mint');

            const held = server.epochs[params.id] ?? [];

            if (held.some((one) => one.epoch === input.epoch))
            {
                return { minted: false, epoch: input.epoch };
            }

            held.push({
                epoch: input.epoch,
                mintedBy: input.mintedBy,
                recipients: [...input.recipients].sort().join(','),
                signature: input.signature,
                confirmation: input.confirmation,
                keys: Object.fromEntries(input.keys.map((key) => [
                    key.deviceId,
                    { ephemeralKey: key.ephemeralKey, wrapped: key.wrapped }
                ]))
            });

            server.epochs[params.id] = held;
            return { minted: true, epoch: input.epoch };
        },

        async messages({ params, query }: { params: { id: string }; query?: { cursor?: string; limit?: string } })
        {
            server.calls.push('chat.messages');
            const found = server.conversations.some((row) => row.id === params.id);
            if (!found)
            {
                throw new ApiError(404, 'not-found', 'No conversation with that id.', undefined);
            }
            const thread = server.messages.filter((one) => one.conversationId === params.id);
            const end = query?.cursor === undefined ? thread.length : thread.findIndex((one) => one.id === query.cursor);
            const start = Math.max(0, end - threadSize(query?.limit));
            const page = thread.slice(start, end);
            return {
                messages: page,
                hasMore: start > 0,
                ...(start > 0 ? { cursor: page[0].id } : {})
            };
        },

        async send({ params, input }: { params: { id: string }; input: FakeSend })
        {
            server.calls.push('chat.send');
            if (server.refuseSend !== null)
            {
                throw new ApiError(403, 'forbidden', server.refuseSend, undefined);
            }
            counter += 1;

            // The id is the CLIENT's, because it is bound into the AAD - a server-assigned id could
            // not be. The timestamp is still this server's: `at` is when the row landed, `clientAt`
            // is what the sender signed, and the two are deliberately different fields.
            const message: ChatMessage = {
                id: input.id,
                conversationId: params.id,
                kind: input.kind,
                from: server.me,
                body: input.body,
                at: new Date(1_700_000_000_000 + counter * 1000).toISOString(),
                epoch: input.epoch,
                seq: input.seq,
                iv: input.iv,
                senderDeviceId: input.senderDeviceId,
                senderAccountId: accountIdOf(server.me),
                signature: input.signature,
                clientAt: input.clientAt,
                commitment: input.commitment
            };

            // The real server also stamps its own MAC here. This one does not, because franking is
            // a claim by the SERVER and `franking.db.spec.ts` owns it against a real Postgres -
            // a fake that made up a frank would only prove it agreed with itself.
            if (input.kind === 'reaction')
            {
                const target = server.messages.find((one) => one.id === input.target && one.conversationId === params.id && one.kind === 'text');
                if (target === undefined)
                {
                    throw new ApiError(404, 'not-found', 'There is no such message here to react to.', undefined);
                }
                target.reactions = [...(target.reactions ?? []), { ...message, target: target.id } as NonNullable<ChatMessage['reactions']>[number]];
                return message;
            }

            server.messages.push(message);

            const row = server.conversations.find((one) => one.id === params.id);
            if (row !== undefined)
            {
                row.last = message;
                row.unread = 0;
            }
            return message;
        },

        async remove({ params }: { params: { id: string; messageId: string } })
        {
            server.calls.push('chat.remove');

            for (const one of server.messages)
            {
                if ((one.reactions ?? []).some((reaction) => reaction.id === params.messageId))
                {
                    one.reactions = (one.reactions ?? []).filter((reaction) => reaction.id !== params.messageId);
                    return { ok: true };
                }
            }

            const found = server.messages.findIndex((one) => one.id === params.messageId && one.conversationId === params.id && one.from === server.me);
            if (found === -1)
            {
                throw new ApiError(404, 'not-found', 'No such message of yours here.', undefined);
            }

            const { id, conversationId, from, at } = server.messages[found];
            server.messages[found] = { id, conversationId, kind: 'deleted', at, ...(from === undefined ? {} : { from }) };
            return { ok: true };
        },

        async read({ params }: { params: { id: string } })
        {
            server.calls.push('chat.read');
            const row = server.conversations.find((one) => one.id === params.id);
            if (row !== undefined)
            {
                row.unread = 0;
            }
            return { ok: true };
        },

        async pin({ params, input }: { params: { id: string }; input: { pinned: boolean } })
        {
            server.calls.push('chat.pin');
            const row = server.conversations.find((one) => one.id === params.id);
            if (row !== undefined)
            {
                row.pinned = input.pinned;
            }
            return { ok: true };
        },

        async direct({ input }: { input: { id: string } })
        {
            server.calls.push('chat.direct');
            const existing = server.conversations.find((row) => row.kind === 'direct'
                && row.members.length === 2
                && row.members.includes(input.id)
                && row.members.includes(server.me));
            if (existing !== undefined)
            {
                return { id: existing.id };
            }

            const id = `c-new-${ input.id }`;
            server.conversations.push({
                id,
                kind: 'direct',
                members: [server.me, input.id],
                pinned: false,
                unread: 0
            });
            return { id };
        }
    },

    /**
     * Groups, in memory.
     *
     * The slug claim is the server's business - `groups.db.spec.ts` owns that race - so this
     * fake takes the folded name and appends a counter when it is taken. What it exists to prove
     * is that the CLIENT sends what it said it would and renders what came back.
     */
    groups:
    {
        async mine()
        {
            server.calls.push('groups.mine');
            return { groups: structuredClone(server.groups.filter((group) => group.members.includes(server.me))) };
        },

        async discover()
        {
            server.calls.push('groups.discover');

            // A private group is not a group you have not joined yet - it is one you are not told
            // about. The real server filters it out of this list, so this one has to as well, or a
            // spec would pass against a server this product does not have.
            return {
                groups: structuredClone(server.groups.filter((group) =>
                    group.privacy === 'public' && !group.members.includes(server.me)))
            };
        },

        async view({ params }: { params: { slug: string } })
        {
            server.calls.push('groups.view');
            const group = server.groups.find((one) => one.slug === params.slug);

            // A private group answers a non-member exactly as one that was never made. Not a 403 -
            // that would confirm it is there, and the point is that a stranger cannot tell a closed
            // door from a typo.
            if (group === undefined || (group.privacy === 'private' && !group.members.includes(server.me)))
            {
                throw new ApiError(404, 'not-found', 'No group there.', undefined);
            }
            return structuredClone(group);
        },

        async create({ input }: { input: { name: string; blurb: string; crest: string; hue: number; game: string; privacy: 'private' | 'public' } })
        {
            server.calls.push('groups.create');
            if (server.refuseGroup !== null)
            {
                throw new ApiError(409, 'conflict', server.refuseGroup, undefined);
            }

            const wanted = input.name.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '') || 'group';
            let slug = wanted;
            for (let attempt = 1; server.groups.some((one) => one.slug === slug); attempt += 1)
            {
                slug = `${ wanted }-${ attempt }`;
            }

            const made: GroupWire = {
                id: slug,
                slug,
                name: input.name.trim(),
                blurb: input.blurb.trim(),
                crest: input.crest,
                privacy: input.privacy,
                hue: input.hue,
                ...(input.game === '' ? {} : { game: input.game }),
                owner: server.me,
                members: [server.me],
                memberCount: 1,
                role: 'owner',
                conversationId: `conv-${ slug }`,
                createdAt: new Date(0).toISOString()
            };
            server.groups.push(made);
            return made;
        },

        async edit({ params, input }: { params: { slug: string }; input: { name: string; blurb: string; crest: string; game: string; privacy: 'private' | 'public' } })
        {
            server.calls.push('groups.edit');
            const group = mustGroup(params.slug);
            group.name = input.name.trim();
            group.blurb = input.blurb.trim();
            group.crest = input.crest;
            group.privacy = input.privacy;
            if (input.game === '')
            {
                delete group.game;
            }
            else
            {
                group.game = input.game;
            }
            return group;
        },

        async join({ params }: { params: { slug: string } })
        {
            server.calls.push('groups.join');
            const group = mustGroup(params.slug);
            if (group.privacy === 'private' && !group.members.includes(server.me))
            {
                throw new ApiError(404, 'not-found', 'No group there.', undefined);
            }
            if (!group.members.includes(server.me))
            {
                group.members.push(server.me);
                group.memberCount = group.members.length;
                group.role = 'member';
                group.conversationId = `conv-${ group.slug }`;
            }
            return group;
        },

        async leave({ params }: { params: { slug: string } })
        {
            server.calls.push('groups.leave');
            const group = mustGroup(params.slug);
            group.members = group.members.filter((handle) => handle !== server.me);
            group.memberCount = group.members.length;
            delete group.role;
            delete group.conversationId;
            if (group.members.length === 0)
            {
                server.groups = server.groups.filter((one) => one.slug !== group.slug);
            }
            return { ok: true };
        },

        async add({ params, input }: { params: { slug: string }; input: { id: string } })
        {
            server.calls.push('groups.add');
            const group = mustGroup(params.slug);
            if (!group.members.includes(input.id))
            {
                group.members.push(input.id);
                group.memberCount = group.members.length;
            }
            return group;
        },

        async remove({ params, input }: { params: { slug: string }; input: { id: string } })
        {
            server.calls.push('groups.remove');
            const group = mustGroup(params.slug);
            group.members = group.members.filter((handle) => handle !== input.id);
            group.memberCount = group.members.length;
            return group;
        },

        async transfer({ params, input }: { params: { slug: string }; input: { id: string } })
        {
            server.calls.push('groups.transfer');
            const group = mustGroup(params.slug);
            group.owner = input.id;
            group.role = 'member';
            return group;
        }
    },

    devices:
    {
        async list()
        {
            server.calls.push('devices.list');
            return {
                devices: server.devices.map((device) => ({ ...device })),
                ...(server.currentDevice === null ? {} : { current: server.currentDevice })
            };
        },

        async challenge({ input }: { input: { id: string } })
        {
            server.calls.push('devices.challenge');
            return {
                nonce: 'n-' + input.id,
                message: `Let this browser read and send your messages on Nura Games (nura.games).\n\nBrowser key: ${ input.id }\nNonce: n-${ input.id }`,
                expiresAt: new Date(1_700_000_300_000).toISOString()
            };
        },

        async enrol({ input }: { input: { id: string; exchangeKey: string; signingKey: string; label: string; signature?: string } })
        {
            server.calls.push('devices.enrol');

            if (server.refuseEnrol === 'burned')
            {
                // One refusal, then the store mints fresh keys and tries once more - which is the
                // behaviour a browser that was signed out from elsewhere has to have.
                server.refuseEnrol = null;
                throw new ApiError(409, 'conflict', 'That device was signed out.', undefined);
            }
            if (server.refuseEnrol === 'unauthorized')
            {
                throw new ApiError(401, 'unauthorized', 'That signature did not match.', undefined);
            }
            const device = server.addDevice({ ...input, ...(input.signature === undefined ? {} : { attested: 'wallet' as const }) });
            server.currentDevice = device.id;
            return device;
        },

        async rename({ params, input }: { params: { id: string }; input: { label: string } })
        {
            server.calls.push('devices.rename');
            const found = mustDevice(params.id);
            found.label = input.label;
            return found;
        },

        async recovery()
        {
            server.calls.push('devices.recovery');

            return server.vault === null
                ? { configured: false }
                : {
                    configured: true,
                    salt: server.vault.salt,
                    checkValue: server.vault.checkValue,
                    createdAt: new Date(0).toISOString()
                };
        },

        async setRecovery({ input }: { input: { salt: string; publicKey: string; wrapped: string; checkValue: string } })
        {
            server.calls.push('devices.setRecovery');
            server.vault = { ...input };

            return {
                configured: true,
                salt: input.salt,
                checkValue: input.checkValue,
                createdAt: new Date(0).toISOString()
            };
        },

        async clearRecovery()
        {
            server.calls.push('devices.clearRecovery');
            server.vault = null;
            server.archive = [];
            return { ok: true };
        },

        async archive({ input }: { input: { conversationId: string; epoch: number; wrapped: string } })
        {
            server.calls.push('devices.archive');

            const held = server.archive.some((one) =>
                one.conversationId === input.conversationId && one.epoch === input.epoch);

            if (!held)
            {
                server.archive.push({ ...input });
            }
            return { ok: true };
        },

        async archived()
        {
            server.calls.push('devices.archived');
            return { entries: server.archive.map((one) => ({ ...one })) };
        },

        async recoveryChallenge({ input }: { input: { deviceId: string } })
        {
            server.calls.push('devices.recoveryChallenge');

            if (server.vault === null)
            {
                throw new ApiError(404, 'not-found', 'This account has no recovery phrase.', undefined);
            }

            return {
                nonce: `nonce-for-${ input.deviceId }`,
                salt: server.vault.salt,
                expiresAt: new Date(1_700_000_300_000).toISOString()
            };
        },

        async restore({ input }: { input: { deviceId: string; nonce: string; signature: string } })
        {
            server.calls.push('devices.restore');

            if (server.vault === null || input.signature === '')
            {
                throw new ApiError(401, 'unauthorized', 'That is not the recovery phrase for this account.', undefined);
            }

            return { wrapped: server.vault.wrapped };
        },

        async revoke({ params }: { params: { id: string } })
        {
            server.calls.push('devices.revoke');
            const found = mustDevice(params.id);
            found.revoked = true;
            return found;
        }
    },

    notifications:
    {
        async list({ query }: { query: { cursor?: string; notice?: string } })
        {
            server.calls.push(query.notice === undefined ? 'notifications.list' : `notifications.list:${ query.notice }`);

            const kept = query.notice === undefined
                ? server.notifications
                : server.notifications.filter((one) => NOTICE_OF[one.kind] === query.notice);

            const from = query.cursor === undefined
                ? 0
                : kept.findIndex((one) => one.id === query.cursor) + 1;

            const slice = kept.slice(from, from + NOTIFY_PAGE);
            const hasMore = from + NOTIFY_PAGE < kept.length;

            return {
                items: slice.map((one) => ({ ...one, ref: { ...one.ref } })),
                hasMore,
                unread: server.notifications.filter((one) => !one.read).length,
                ...(hasMore && slice.length > 0 ? { cursor: slice[slice.length - 1].id } : {})
            };
        },

        async read({ params }: { params: { id: string } })
        {
            server.calls.push('notifications.read');
            const found = server.notifications.find((one) => one.id === params.id);
            if (found !== undefined)
            {
                found.read = true;
            }
            return { ok: true };
        },

        async readAll()
        {
            server.calls.push('notifications.read-all');
            for (const one of server.notifications)
            {
                one.read = true;
            }
            return { ok: true };
        },

        async dismiss({ params }: { params: { id: string } })
        {
            server.calls.push('notifications.dismiss');
            server.notifications = server.notifications.filter((one) => one.id !== params.id);
            return { ok: true };
        },

        async pushKey()
        {
            server.calls.push('notifications.push-key');
            return server.pushKey === null ? {} : { key: server.pushKey };
        },

        async subscribe({ input }: { input: { endpoint: string; p256dh: string; auth: string } })
        {
            server.calls.push('notifications.subscribe');
            server.pushSubscriptions = [
                ...server.pushSubscriptions.filter((one) => one.endpoint !== input.endpoint),
                input
            ];
            return { ok: true };
        },

        async unsubscribe({ input }: { input: { endpoint: string } })
        {
            server.calls.push('notifications.unsubscribe');
            server.pushSubscriptions = server.pushSubscriptions.filter((one) => one.endpoint !== input.endpoint);
            return { ok: true };
        }
    },

    tables:
    {
        async watchable({ query }: { query: { game?: string } })
        {
            server.calls.push('tables.watchable');
            return { tables: server.watching.filter((row) => query.game === undefined || row.game === query.game) };
        },

        async mine()
        {
            server.calls.push('tables.mine');
            return {
                tables: structuredClone(server.tables.filter((table) =>
                    table.status !== 'closed' && table.chairs.some((chair) => chair.who === server.me)))
            };
        },

        async view({ params }: { params: { id: string } })
        {
            server.calls.push('tables.view');
            return structuredClone(restate(mustSee(params.id)));
        },

        async byCode({ params }: { params: { code: string } })
        {
            server.calls.push('tables.byCode');
            const table = server.tables.find((one) => one.code.toLowerCase() === params.code.toLowerCase());
            if (table === undefined)
            {
                throw new ApiError(404, 'not-found', 'No table there.', undefined);
            }
            return restate(table);
        },

        async create({ input }: { input: {
            game: string;
            seats: number;
            mode: 'live' | 'turns';
            privacy: 'invite' | 'room' | 'friends' | 'public';
            target: number;
            cube: boolean;
            blinds: string;
            chat: boolean;
            voice: VoiceScope;
            teams: boolean;
            invitees: string[];
            stake?: string;
        } })
        {
            server.calls.push('tables.create');
            server.asked.push({ game: input.game, seats: input.seats, teams: input.teams });

            if (input.invitees.some((handle) => !reachable(handle)))
            {
                throw noInvitee();
            }

            return restate(newTable(input));
        },

        async quick({ input }: { input: QuickAsk & { game: string; voice: VoiceScope; stake?: string; signature?: string } })
        {
            server.calls.push('tables.quick');
            server.sought.push({ ...input });

            const rules = TABLE_RULES[input.game as keyof typeof TABLE_RULES];

            if (rules === undefined)
            {
                throw tableRefusal('quick-game', 'That game cannot be played right now.');
            }

            const want = quickOf(rules, input);

            if (!want.ok)
            {
                throw tableRefusal('quick-options', 'That is not a table this game makes.');
            }

            const { filter } = want;
            const fits = (table: TableWire) =>
                table.status !== 'closed'
                && table.matchId === undefined
                && !keptOut(table, server.me)
                && (table.privacy === 'public' || (table.privacy === 'friends' && table.host !== undefined && server.friends.includes(table.host)))
                && table.game === input.game
                && table.mode === filter.mode
                && (['seats', 'target', 'blinds', 'cube', 'teams'] as const).every((option) => filter[option] === null || filter[option] === table[option])
                && table.stake === input.stake;
            const mine = (chair: SeatWire) => chair.who === server.me;
            const free = (table: TableWire) => table.chairs.filter((chair) => chair.who === undefined && (chair.invited === undefined || chair.invited === server.me));
            const playing = filter.mode === 'live'
                ? server.tables.find((table) => table.mode === 'live' && table.matchId !== undefined && table.chairs.some(mine)
                    && !(server.outOfGame[table.matchId] ?? []).includes(server.me))
                : undefined;

            if (playing !== undefined)
            {
                return structuredClone(restate(playing));
            }

            const waiting = server.tables.find((table) => fits(table) && table.chairs.some((chair) => mine(chair) && chair.ready));

            if (waiting !== undefined)
            {
                return structuredClone(restate(waiting));
            }

            const joined = server.tables
                .filter((table) => fits(table) && !table.chairs.some(mine) && free(table).length > 0)
                .sort((a, b) => free(a).length - free(b).length)[0];

            const table = joined ?? Object.assign(newTable({ ...want.make, game: input.game, privacy: 'public', chat: true, voice: input.voice, invitees: [], ...(input.stake === undefined ? {} : { stake: input.stake }) }), { quick: true });
            const seat = joined === undefined
                ? 0
                : chairFor(free(table).map((chair) => chair.seat), table.chairs.filter((chair) => chair.who !== undefined).map((chair) => chair.seat), table.teams);
            const chair = table.chairs.find((one) => one.seat === seat)!;

            chair.who = server.me;
            chair.ready = true;

            if (table.stake === undefined && table.chairs.every((one) => one.who !== undefined && one.ready))
            {
                table.matchId = `match-${ table.id }`;
            }

            return structuredClone(restate(table));
        },

        async claim({ params }: { params: { id: string } })
        {
            server.calls.push('tables.claim');
            const table = mustSee(params.id);
            if (table.status === 'closed')
            {
                throw tableRefusal('table-closed', 'That table has closed.');
            }

            const held = table.chairs.find((chair) => chair.who === server.me);
            if (held !== undefined)
            {
                return { table: restate(table), seat: held.seat };
            }

            if (table.matchId !== undefined)
            {
                throw tableRefusal('playing', 'A game is being played at that table.');
            }

            if (keptOut(table, server.me))
            {
                throw tableRefusal('kept-out', 'The host took you out of that table.');
            }

            const free = table.chairs.find((chair) =>
                chair.who === undefined && (chair.invited === undefined || chair.invited === server.me));

            if (free === undefined)
            {
                return { table: restate(table) };
            }

            free.who = server.me;
            return { table: restate(table), seat: free.seat };
        },

        async leave({ params, input }: { params: { id: string }; input: { forfeit: boolean } })
        {
            server.calls.push(input.forfeit ? 'tables.leave:forfeit' : 'tables.leave');
            const table = mustTable(params.id);
            const inTheGame = table.matchId !== undefined
                && table.chairs.some((chair) => chair.who === server.me)
                && !(server.outOfGame[table.matchId] ?? []).includes(server.me);

            if (!input.forfeit && inTheGame)
            {
                throw tableRefusal('playing', 'A game has started at that table, and leaving it now is a forfeit.');
            }

            for (const chair of table.chairs)
            {
                if (chair.who === server.me)
                {
                    delete chair.who;
                    chair.ready = false;
                }
            }
            restate(table);
            if (table.taken === 0)
            {
                table.status = 'closed';
            }
            return { ok: true };
        },

        async stake({ params }: { params: { id: string } })
        {
            server.calls.push(`tables.stake ${ params.id }`);
            nuraRefusal();
            return { ...server.nura.terms };
        },

        async quickStake({ input }: { input: { game: string; stake: string } })
        {
            server.calls.push(`tables.quickStake ${ input.game } ${ input.stake }`);
            nuraRefusal();
            return { ...server.nura.terms };
        },

        async ready({ params, input }: { params: { id: string }; input: { ready: boolean; signature?: string } })
        {
            server.calls.push('tables.ready');
            server.nura.signatures.push(input.signature);
            const table = mustTable(params.id);

            if (table.stake !== undefined && input.ready && input.signature === undefined)
            {
                throw tableRefusal('paid-consent', 'Sign your stake for this game again.');
            }

            const mine = table.chairs.find((chair) => chair.who === server.me);
            if (mine !== undefined)
            {
                mine.ready = input.ready;
            }
            return restate(table);
        },

        async invite({ params, input }: { params: { id: string }; input: { id: string } })
        {
            server.calls.push('tables.invite');
            const table = mustTable(params.id);

            if (!reachable(input.id) || !PEOPLE_FIXTURES.some((one) => one.handle === input.id))
            {
                throw noInvitee();
            }

            if (keptOut(table, input.id))
            {
                if (table.host !== server.me)
                {
                    throw noInvitee();
                }

                server.keptOut[table.id] = server.keptOut[table.id].filter((one) => one !== input.id);
            }

            const free = table.chairs.find((chair) => chair.who === undefined && chair.invited === undefined);
            if (free !== undefined)
            {
                free.invited = input.id;
            }
            return restate(table);
        },

        async remove({ params, input }: { params: { id: string }; input: { id: string } })
        {
            server.calls.push('tables.remove');

            const table = mustTable(params.id);
            const sitting = (who: string) => table.chairs.some((chair) => chair.who === who);

            if (table.host !== server.me || !sitting(server.me) || table.quick === true)
            {
                throw noTable();
            }

            if (table.status === 'closed')
            {
                throw tableRefusal('table-closed', 'That table has closed.');
            }

            if (table.matchId !== undefined)
            {
                throw tableRefusal('playing', 'A game is being played at that table.');
            }

            if (input.id === server.me || !sitting(input.id))
            {
                throw noTable();
            }

            for (const chair of table.chairs)
            {
                if (chair.who === input.id)
                {
                    delete chair.who;
                    chair.ready = false;
                }

                if (chair.invited === input.id)
                {
                    delete chair.invited;
                }
            }

            server.keptOut[table.id] = [...(server.keptOut[table.id] ?? []), input.id];

            return structuredClone(restate(table));
        },

        async start({ params }: { params: { id: string } })
        {
            server.calls.push('tables.start');
            const table = mustTable(params.id);
            if (table.chairs.some((chair) => chair.who === undefined))
            {
                throw tableRefusal('chairs-empty', 'Every chair has to be taken first.');
            }
            if (table.chairs.some((chair) => !chair.ready))
            {
                throw tableRefusal('not-ready', 'Everybody has to be ready first.');
            }
            return {};
        },

        async close({ params }: { params: { id: string } })
        {
            server.calls.push('tables.close');
            const table = mustTable(params.id);

            if (table.matchId !== undefined)
            {
                throw tableRefusal('playing', 'Finish or resign the game first.');
            }

            table.status = 'closed';
            return { ok: true };
        },

        async voice({ params, input }: { params: { id: string }; input: { voice: VoiceScope } })
        {
            server.calls.push('tables.voice');
            const table = mustTable(params.id);

            if (table.status === 'closed')
            {
                throw tableRefusal('table-closed', 'That table has closed.');
            }

            if (input.voice === 'team' && !table.teams)
            {
                throw new ApiError(422, 'validation-failed', 'That is not a table this game makes.', { voice: 'A call for one side needs a table of two sides.' });
            }

            if (table.voice === input.voice)
            {
                return table;
            }

            if (table.teams && table.matchId !== undefined)
            {
                throw tableRefusal('playing', 'The call a game began under stays until it ends.');
            }

            if (table.voice === 'team' || input.voice === 'team')
            {
                for (const chair of table.chairs)
                {
                    chair.ready = false;
                }
            }

            table.voice = input.voice;
            return table;
        }
    },

    parties:
    {
        async state()
        {
            server.calls.push('parties.state');

            return await server.parties.state(server.me);
        },

        async invite({ input }: { input: { id: string; game: string } })
        {
            server.calls.push('parties.invite');
            teamed(await server.parties.invite(server.me, input.id, input.game));

            return await server.parties.state(server.me);
        },

        async accept({ params }: { params: { id: string } })
        {
            server.calls.push('parties.accept');
            teamed(await server.parties.accept(server.me, params.id));

            return await server.parties.state(server.me);
        },

        async decline({ params }: { params: { id: string } })
        {
            server.calls.push('parties.decline');
            teamed(server.parties.decline(server.me, params.id));

            return { ok: true };
        },

        async leave({ params }: { params: { id: string } })
        {
            server.calls.push('parties.leave');
            teamed(server.parties.leave(server.me, params.id));

            return { ok: true };
        }
    },

    /**
     * Games that have finished: none, unless a spec puts some in `server.history`.
     *
     * The same reason `social.record` answers empty: the profile pages page this on mount, and a
     * namespace the fake does not have at all is an unhandled rejection rather than a missing
     * feature. `cursor` is absent, which is how the store learns there is no more.
     */
    matches:
    {
        async history()
        {
            server.calls.push('matches.history');
            return { matches: server.history.map((row) => ({ ...row })) };
        },

        async proof({ params }: { params: { id: string } })
        {
            server.calls.push('matches.proof');

            const refused = server.proofRefused;
            const held = server.proofs[params.id];

            if (refused !== null)
            {
                throw new ApiError(refused.status, refused.code, refused.code, undefined);
            }

            if (held === undefined)
            {
                throw new ApiError(404, 'not-found', 'No game there.', undefined);
            }

            return structuredClone(held);
        },

        async watch({ params, query }: { params: { id: string }; query?: { rev?: string } })
        {
            server.calls.push('matches.watch');
            server.watchedFrom.push(query?.rev ?? '');

            const held = server.watches[params.id] as { match: { rev: number } } | undefined;

            if (held === undefined)
            {
                throw new ApiError(404, 'not-found', 'Nothing to watch there.', undefined);
            }

            const asked = query?.rev ?? '';
            const shown = held.match.rev;
            const from = /^\d{1,15}$/.test(asked) ? Math.min(Number(asked), shown) : shown;
            const events = shown - from > WATCH_TAIL
                ? []
                : (server.ledgers[params.id] ?? []).filter((event) => event.rev > from && event.rev <= shown);

            return structuredClone({ ...held, events });
        }
    },

    social:
    {
        async graph()
        {
            server.calls.push('social.graph');
            return {
                friends: server.friends.filter(reachable).map(personWire),

                // The person on the other end travels with the request, exactly as the server sends
                // it. A fake that sent only handles would be rehearsing the defect this fixed: the
                // browser renders the row out of `people.store`, so a request whose sender it has
                // never been told about renders as nothing at all.
                incoming: server.incoming.filter((request) => reachable(request.from))
                    .sort((a, b) => b.at.localeCompare(a.at))
                    .map((request) => ({ ...request, person: personWire(request.from) })),
                outgoing: server.outgoing.filter((request) => reachable(request.to))
                    .sort((a, b) => b.at.localeCompare(a.at))
                    .map((request) => ({ ...request, person: personWire(request.to) })),
                blocked: server.blocks.map(personWire),
                mutes: [...server.mutes]
            };
        },

        /**
         * A person's record, which the profile pages read on mount.
         *
         * It answers EMPTY rather than being absent. A fake that simply has no route for something
         * the product calls is a fake that rejects, and the rejection lands on whichever spec file
         * happened to be running - which is how a suite with nothing wrong in it started failing a
         * different file on every shuffled run. An account that has played nothing is also the
         * honest fixture: no match has ever been played in `fake-api`.
         */
        async record({ params }: { params: { handle: string } })
        {
            server.calls.push('social.record');
            return { handle: params.handle, progress: { ...server.progress }, games: [], achievements: server.achievements };
        },

        async ladder({ params, query }: { params: { handle: string; family: string }; query: { game?: string } })
        {
            server.calls.push('social.ladder');
            const found = server.ladders[`${ query.game ?? 'all' }-${ params.family }`];

            if (found === undefined)
            {
                throw new ApiError(404, 'not-found', 'No such achievements.', undefined);
            }

            return found;
        },

        async person({ params }: { params: { handle: string } })
        {
            server.calls.push('social.person');
            if (!PEOPLE_FIXTURES.some((one) => one.handle === params.handle))
            {
                throw new ApiError(404, 'not-found', 'No account with that name.', undefined);
            }
            const relation = server.blocks.includes(params.handle) ? 'blocked' as const
                : server.friends.includes(params.handle) ? 'friend' as const : 'none' as const;
            const refusal = server.refusals[params.handle];

            return { person: personWire(params.handle), relation, mutual: 0, ...(refusal === undefined ? {} : { refusal }) };
        },

        async names({ query }: { query: { handles: string } })
        {
            server.calls.push('social.names');
            const handles = query.handles.split(',').filter((handle) => reachable(handle) && PEOPLE_FIXTURES.some((one) => one.handle === handle));
            return { people: handles.map((handle) => personWire(handle)) };
        },

        async people()
        {
            server.calls.push('social.people');
            return { people: PEOPLE_FIXTURES.map((one) => one.handle).filter(reachable).slice(0, server.directoryMax).map(personWire) };
        },

        async search({ query }: { query: { q: string } })
        {
            server.calls.push('social.search');
            server.searched.push(query.q);

            const needle = searchNeedle(query.q);

            if ([...needle].length < SEARCH_FROM)
            {
                return { people: [] };
            }

            return {
                people: PEOPLE_FIXTURES
                    .filter((one) => reachable(one.handle) && (searchNeedle(one.handle).includes(needle) || searchNeedle(one.displayName).includes(needle)))
                    .slice(0, PEOPLE_FOUND_MAX)
                    .map((one) => personWire(one.handle))
            };
        },

        async suggestions()
        {
            server.calls.push('social.suggestions');
            const known = new Set([...server.friends, ...server.incoming.map((one) => one.from), ...server.outgoing.map((one) => one.to)]);
            return {
                suggestions: PEOPLE_FIXTURES
                    .map((one) => one.handle)
                    .filter((handle) => reachable(handle) && !known.has(handle))
                    .map((handle) => ({ person: personWire(handle), mutual: 0 }))
            };
        },

        async request({ input }: { input: { id: string } })
        {
            server.calls.push('social.request');

            const theirs = server.incoming.find((one) => one.from === input.id);

            if (theirs !== undefined)
            {
                server.incoming = server.incoming.filter((one) => one !== theirs);
                server.friends.push(input.id);

                return { outcome: 'accepted' as const };
            }

            counter += 1;
            server.outgoing.push({
                id: `req-out-${ counter }`,
                from: server.me,
                to: input.id,
                at: new Date(1_700_000_000_000).toISOString()
            });
            return { outcome: 'sent' as const };
        },

        async answer({ input }: { input: { id: string; outcome: 'accepted' | 'declined' } })
        {
            server.calls.push('social.answer');
            const request = server.incoming.find((one) => one.id === input.id);
            server.incoming = server.incoming.filter((one) => one.id !== input.id);
            if (request !== undefined && input.outcome === 'accepted')
            {
                server.friends.push(request.from);
            }
            return { ok: true };
        },

        async withdraw({ input }: { input: { id: string } })
        {
            server.calls.push('social.withdraw');
            server.outgoing = server.outgoing.filter((one) => one.to !== input.id);
            return { ok: true };
        },

        async unfriend({ input }: { input: { id: string } })
        {
            server.calls.push('social.unfriend');
            server.friends = server.friends.filter((one) => one !== input.id);
            return { ok: true };
        },

        async block({ input }: { input: { id: string } })
        {
            server.calls.push('social.block');
            if (!server.blocks.includes(input.id))
            {
                server.blocks.push(input.id);
            }
            server.friends = server.friends.filter((one) => one !== input.id);
            server.incoming = server.incoming.filter((one) => one.from !== input.id);
            server.outgoing = server.outgoing.filter((one) => one.to !== input.id);
            return { ok: true };
        },

        async unblock({ input }: { input: { id: string } })
        {
            server.calls.push('social.unblock');
            server.blocks = server.blocks.filter((one) => one !== input.id);
            return { ok: true };
        },

        async report({ input }: { input: { id: string; category: string } })
        {
            server.calls.push('social.report');
            counter += 1;
            const id = `report-${ counter }`;
            server.reports.push({
                id,
                against: input.id,
                category: input.category,
                status: 'received',
                at: new Date(1_700_000_000_000).toISOString()
            });
            return { id };
        },

        async reports()
        {
            server.calls.push('social.reports');
            return { reports: [...server.reports] };
        },

        async privacy(): Promise<Privacy>
        {
            server.calls.push('social.privacy');
            return {
                allowStrangerMessages: server.minor ? false : server.allowStrangerMessages,
                showOnline: server.showOnline,
                isMinor: server.minor
            };
        },

        // The clamp is the server's, not the caller's: a minor asking for strangers is answered
        // with false, exactly as the real one does.
        async setPrivacy({ input }: { input: { allowStrangerMessages: boolean; showOnline: boolean } }): Promise<Privacy>
        {
            server.calls.push('social.set-privacy');
            server.allowStrangerMessages = server.minor ? false : input.allowStrangerMessages;
            server.showOnline = input.showOnline;
            return {
                allowStrangerMessages: server.allowStrangerMessages,
                showOnline: server.showOnline,
                isMinor: server.minor
            };
        },

        async mute({ input }: { input: { kind: MuteSubject; id: string; muted: boolean } })
        {
            server.calls.push('social.mute');
            if (server.refuseMute)
            {
                throw new ApiError(503, 'unavailable', 'The server is not answering.', undefined);
            }
            server.mutes = server.mutes.filter((entry) => !(entry.kind === input.kind && entry.id === input.id));
            if (input.muted)
            {
                server.mutes.push({ kind: input.kind, id: input.id });
            }
            return { ok: true };
        }
    },

    auth:
    {
        async me()
        {
            server.calls.push('auth.me');
            return server.account === null ? {} : { account: server.account };
        },

        async challenge({ input }: { input: { address: string; device?: string } })
        {
            server.calls.push('auth.challenge');
            if (server.refuse === 'challenge-unreachable')
            {
                throw new ApiError(503, 'unavailable', 'The server is not answering.', undefined);
            }
            if (server.refuse === 'challenge-busy')
            {
                throw new ApiError(429, 'too-many-requests', 'Too many requests', undefined);
            }
            const nonce = `nonce-${ server.calls.length }`;
            const live = server.devices.some((one) => one.id === input.device && !one.revoked);
            server.issued = {
                address: input.address,
                nonce,
                ...(input.device === undefined ? {} : { device: input.device }),
                message: input.device === undefined || live
                    ? `Sign in to Nura Games (nura.games).\n\nNonce: ${ nonce }`
                    : `Sign in to Nura Games (nura.games) and let this browser read and send your messages.\n\nBrowser key: ${ input.device }\nNonce: ${ nonce }`
            };
            return { ...server.issued, expiresAt: '2026-01-01T00:00:00.000Z' };
        },

        async wallet({ input }: { input: { address: string; nonce: string; signature: string; providerRdns?: string; device?: { id: string; exchangeKey: string; signingKey: string; label: string } } })
        {
            server.calls.push('auth.wallet');
            server.received = input;
            if (server.refuse === 'bad-signature')
            {
                throw new ApiError(401, 'unauthorized', 'That signature did not match the address.', undefined);
            }
            if (server.refuse === 'wallet-unreachable')
            {
                throw new ApiError(503, 'unavailable', 'The server is not answering.', undefined);
            }
            if (server.refuse === 'wallet-busy')
            {
                throw new ApiError(429, 'too-many-requests', 'Too many requests', undefined);
            }
            if (server.refuse === 'wallet-suspended')
            {
                throw new ApiError(403, 'suspended', 'This account is suspended.', server.suspension);
            }
            server.account = walletAccount(input.address);
            return { account: server.account };
        },

        async signOut()
        {
            server.calls.push('auth.sign-out');
            server.account = null;
            return { ended: 1 };
        },

        async signOutEverywhere()
        {
            server.calls.push('auth.sign-out-everywhere');
            server.account = null;
            const ended = server.sessions;
            server.sessions = 0;
            return { ended };
        },

        async claimHandle({ input }: { input: { handle: string } })
        {
            server.calls.push('auth.handle');

            // The real route claims against a unique index and answers 409 when it is taken. The
            // fake has to be able to do that too, or the one branch of the profile sheet that
            // cannot simply be retried has nothing exercising it.
            if (server.takenHandles.includes(input.handle.toLowerCase()))
            {
                throw new ApiError(409, 'conflict', 'That name is taken.', undefined);
            }

            if (server.account !== null)
            {
                server.account = { ...server.account, handle: input.handle };
            }
            return { handle: input.handle };
        },

        async profile({ input }: { input: { displayName: string; bio: string; avatar?: string } })
        {
            server.calls.push('auth.profile');
            if (server.account === null)
            {
                throw new ApiError(401, 'unauthorized', 'Sign in to continue.', undefined);
            }

            // Trimmed and bounded the way the wire shape says, so a store that adopted the INPUT
            // rather than the answer would visibly disagree here.
            const { avatar: _dropped, ...rest } = server.account;
            const avatar = input.avatar === undefined ? server.account.avatar : input.avatar;
            server.account = {
                ...rest,
                displayName: input.displayName.trim().slice(0, 40),
                bio: input.bio.trim().slice(0, 240),
                ...(avatar === undefined || avatar === '' ? {} : { avatar })
            };
            return server.account;
        },

        async avatar({ input }: { input: { data: string } })
        {
            server.calls.push('auth.avatar');
            server.uploaded = input.data;
            return { url: `${ window.location.origin }/avatars/${ 'ab'.repeat(32) }.webp` };
        }
    }
};

const refusals = new Set<() => void>();

export function onUnauthorized(listener: () => void)
{
    refusals.add(listener);

    return () =>
    {
        refusals.delete(listener);
    };
}

export function answeredUnauthorized()
{
    for (const listener of [...refusals])
    {
        listener();
    }
}

export { ApiError, applyFieldErrors };
