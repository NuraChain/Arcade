import { createHmac, randomUUID } from 'node:crypto';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '@azerothjs/http';
import type { DataSource } from 'typeorm';
import { getAddress } from 'viem';

import { createCatalogueService } from './domains/catalogue/service.ts';
import { createChatService, type ConversationRow, type MessageRow } from './domains/chat/service.ts';
import { createFranking, discloses } from './domains/chat/franking.ts';
import { affectedBy } from './lib/rows.ts';
import { createEpochService } from './domains/chat/epochs.ts';
import { threadSize } from './domains/chat/pages.ts';
import { isDeviceId } from './domains/device/id.ts';
import { createPeerDevices, type PeerDeviceRow } from './domains/device/peers.ts';
import { namesDevice } from './domains/device/resource.ts';
import { createRecoveryService } from './domains/device/recovery-service.ts';
import { createDeviceService, type DeviceRow } from './domains/device/service.ts';
import { createGroupService, type GroupRow } from './domains/group/service.ts';
import { createNotifyService, type NotificationRow } from './domains/notify/service.ts';
import { isNotice, NOTICE_OF, type Notice } from './domains/notify/notices.ts';
import { sendPush, type VapidKeys } from './domains/notify/push.ts';
import { createAchieveService } from './domains/achieve/service.ts';
import { endingOf } from './domains/match/declare.ts';
import { createMatchService, voidedOf, type MatchLoad } from './domains/match/service.ts';
import { WATCH_DELAY_MS, WATCH_TAIL } from './domains/match/turns.ts';
import { createWatchService } from './domains/match/watch.ts';
import { createParties, type PartyWhy } from './domains/party/parties.ts';
import { partyRefused } from './domains/party/refusal.ts';
import { createRegistry } from './domains/party/registry.ts';
import { createTableService, noInvitee, type TableRow } from './domains/table/service.ts';
import { strikes } from './domains/table/sweep.ts';
import { teamsOf } from './domains/table/teams.ts';
import { createChainProfiles, recordValue } from './chain/profile.ts';
import { createNftReader } from './chain/nfts.ts';
import { createVault, type Vault } from './chain/vault.ts';
import { seatsOfMask } from './domains/stake/policy.ts';
import { createStakeService, type StakeSweep } from './domains/stake/service.ts';
import { createIdentityService } from './domains/identity/service.ts';
import { isAdminAddress } from './domains/identity/admin.ts';
import { may, type Ability, type GrantedRole } from './domains/admin/roles.ts';
import { createPeopleService } from './domains/admin/people.ts';
import { createLiveService, type Call, type Online } from './domains/admin/live.ts';
import { createPlayService, stuckKindOf, type Stuck } from './domains/admin/play.ts';
import { createReportsService } from './domains/admin/reports.ts';
import { createStaffService } from './domains/admin/staff.ts';
import { createVaultAdmin } from './domains/stake/admin.ts';
import { avatarHashOf } from './domains/identity/avatar.ts';
import { maySeeOnline } from './domains/social/policy.ts';
import { createSocialService, type PersonRow } from './domains/social/service.ts';
import type { ServerConfig } from './env.ts';
import { readSessionToken, SESSION_TTL_SECONDS } from './http/auth.ts';
import type { OpsReader } from './http/ops.ts';
import type { MatchEventLog, Ports } from './ports.ts';
import type {
    Account,
    ChatMessage,
    VoiceIce,
    ChatReaction,
    ConversationDevices,
    ConversationSummary,
    Device,
    GroupSummary,
    Notification,
    PersonSummary,
    MatchPlay,
    MatchProof,
    MatchView,
    Pulse,
    TableSummary
} from './schemas.ts';
import { matchView } from './schemas.ts';

/**
 * Builds the real implementations behind `Ports`.
 *
 * SERVER-ONLY. This is the first file in the chain that may touch the DataSource and the
 * entities, and nothing the browser imports may ever reach it.
 */
/**
 * What the realtime layer needs to be told, and nothing about how it says it.
 *
 * A structural type rather than the `Hub` itself, so this file does not import the gateway and
 * the client-safe line stays where it is: `api.ts` never learns a socket exists.
 */
export interface WriteListener
{
    chatChanged(conversationId: string, ...also: string[]): void;
    chatSeen(conversationId: string, userId: string): void;
    socialChanged(...userIds: string[]): void;
    edgesChanged(...userIds: string[]): void;
    selfChanged(userId: string, what: 'notifications' | 'devices' | 'profile' | 'party' | 'vault'): void;
    gamePushed(pushes: readonly { userId: string; match: MatchView; events: MatchEventLog[] }[]): void;
    gameWatched(tableId: string, matchId: string, afterMs: number, players: readonly string[]): void;
    tableChanged(tableId: string, people: readonly string[]): void;
    tableViewed(userId: string, tableId: string): void;
    catalogueChanged(): void;
    sessionsRevoked(sessionIds: readonly string[]): void;
    seen(userId: string): void;
}

export interface PresenceReader
{
    present(userIds: readonly string[]): ReadonlySet<string>;
    online?(): readonly Online[];
    calls?(): readonly Call[];
    sockets?(): number;
}

/**
 * Everything the composition root gets: the ports the API may call, plus the periodic work.
 *
 * `Ports` is the CLIENT-SAFE contract - `api.ts` imports it as a type and the browser's typecheck
 * program follows - so a sweep that only the server runs does not belong in it. It belongs here,
 * where `main.ts` already reaches, and the api still takes the narrower thing.
 */
export interface TurnSweep
{
    played: number;
    stuck: { matchId: string; game: string; reason: string }[];
}

export interface TableSweep
{
    stoodUp: number;
    closed: number;
    failed: { tableId: string; reason: string }[];
}

export type Note = (event: string, fields: Record<string, unknown>) => void;

export interface Services extends Ports
{
    jobs: {
        sweepTurns(forMs: number): Promise<TurnSweep>;
        sweepTables(): Promise<TableSweep>;
        sweepStakes(forMs: number): Promise<StakeSweep>;
        waiting(): Promise<{ game: string; mode: string; players: number; tables: number; oldest: number }[]>;
        otherServers(): Promise<number>;
        tidy(): Promise<Record<string, number>>;
        liftSuspensions(): Promise<number>;
    };

    pulse(): Promise<Pulse>;
}

const TURN_TTL_SECONDS = 3600;

const PUSH_AT_ONCE = 64;

const WATCHABLE_MAX = 48;

const WAITING_SEATS = 500;

export function buildPorts(db: DataSource, config: ServerConfig, live?: WriteListener, presence?: PresenceReader, note?: Note, vault?: Vault, ops?: OpsReader): Services
{
    const here = (userIds: readonly string[]) => presence?.present(userIds) ?? new Set(userIds);

    // Secure cookies require TLS, and the browser silently drops a Secure cookie on plain http -
    // which in development is every request. Decided from configuration, never from a header a
    // caller controls.
    const secureCookies = config.origin.startsWith('https://');

    const social = createSocialService(db);
    const franking = createFranking(config.secret);
    const chat = createChatService(db, social, franking);
    const group = createGroupService(db, social);
    const achieve = createAchieveService(db);
    const table = createTableService(db, social);
    const catalogue = createCatalogueService(db);
    const notify = createNotifyService(db, social);

    /**
     * Push, if this deployment has it.
     *
     * All three variables together or none: a half-configured push is one that asks for permission
     * and then never delivers, which is worse than not asking.
     */
    const vapid: VapidKeys | null = config.vapidPublicKey !== '' && config.vapidPrivateKey !== '' && config.vapidSubject !== ''
        ? { publicKey: config.vapidPublicKey, privateKey: config.vapidPrivateKey, subject: config.vapidSubject }
        : null;

    /**
     * Wakes somebody's browsers, and never makes a request wait for it.
     *
     * The push carries nothing. It is a nudge to open the app, where the content comes over a
     * session the reader is already authorised on - which is the only shape that survives
     * `nura-e2ee/v1`, because this server will not be able to read the message either.
     *
     * Fire and forget on purpose: a push service being slow must not make sending a message slow,
     * and a push service being down must not make it fail.
     */
    let pushing = 0;

    const wake = (userId: string) =>
    {
        if (vapid === null || pushing >= PUSH_AT_ONCE)
        {
            return;
        }

        pushing += 1;

        void (async () =>
        {
            for (const subscription of await notify.subscriptionsOf(userId))
            {
                const outcome = await sendPush(subscription.endpoint, vapid, Date.now());
                if (outcome === 'gone')
                {
                    await notify.retire(subscription.id);
                }
            }
        })().catch(() => undefined).finally(() =>
        {
            pushing -= 1;
        });
    };

    /** Tells somebody, then wakes them if they asked to be woken. */
    const tell = async (input: {
        userId: string;
        kind: Notification['kind'];
        actorId: string | null;
        ref: Record<string, string>;
        dedupeKey: string;
    }) =>
    {
        if (await notify.tell(input))
        {
            live?.selfChanged(input.userId, 'notifications');
            wake(input.userId);
        }
    };

    const retract = async (userId: string, kind: Notification['kind'], dedupeKey: string) =>
    {
        if (await notify.retract(userId, kind, dedupeKey))
        {
            live?.selfChanged(userId, 'notifications');
        }
    };

    const asNotification = (row: NotificationRow) =>
    {
        const item: Notification = {
            id: row.id,
            kind: row.kind,
            ref: row.ref,
            count: row.count,
            at: row.created_at.toISOString(),
            read: row.read_at !== null
        };
        if (row.actor !== null)
        {
            item.actor = row.actor;
        }
        return item;
    };

    /**
     * The cursor, as one opaque string.
     *
     * The client never takes it apart - it hands back the last one it was given - which is what
     * lets the keyset change shape later without a client release.
     */
    const encodeCursor = (at: Date, id: string) =>
        Buffer.from(`${ at.toISOString() }|${ id }`, 'utf8').toString('base64url');

    const LIST_CURSOR = /^([0-9T:.\-Z]*)\|([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

    const listCursorOf = (row: { last_at: Date | null; id: string }) =>
        Buffer.from(`${ row.last_at?.toISOString() ?? '' }|${ row.id }`, 'utf8').toString('base64url');

    const listAfter = (cursor: string | undefined): { at: Date | null; id: string } | null =>
    {
        const found = cursor === undefined ? null : LIST_CURSOR.exec(Buffer.from(cursor, 'base64url').toString('utf8'));

        if (found === null)
        {
            return null;
        }

        const at = found[1] === '' ? null : new Date(found[1]);

        return at !== null && Number.isNaN(at.getTime()) ? null : { at, id: found[2] };
    };

    const decodeCursor = (cursor: string | undefined) =>
    {
        const found = listAfter(cursor);

        return found === null || found.at === null ? null : { at: found.at, id: found.id };
    };

    const asMessage = (row: MessageRow) =>
    {
        const message: ChatMessage = {
            id: row.id,
            conversationId: row.conversation_id,
            kind: row.kind,
            at: row.created_at.toISOString()
        };
        if (row.sender !== null)
        {
            message.from = row.sender;
        }
        if (row.body !== null)
        {
            message.body = row.body;
        }
        if (row.payload !== null)
        {
            message.payload = row.payload as ChatMessage['payload'];
        }

        // The envelope travels whole or not at all, which the CHECK constraints already hold: a
        // recipient rebuilds the AAD from these fields and a partial one verifies against nothing.
        if (row.epoch !== null && row.seq !== null && row.iv !== null
            && row.sender_device_id !== null && row.signature !== null && row.client_at !== null
            && row.sender_account_id !== null)
        {
            message.epoch = row.epoch;
            message.seq = Number(row.seq);
            message.iv = row.iv;
            message.senderDeviceId = row.sender_device_id;
            message.senderAccountId = row.sender_account_id;
            message.signature = row.signature;
            message.clientAt = row.client_at.toISOString();

            if (row.commitment !== null)
            {
                message.commitment = row.commitment;
            }
        }

        if (row.expires_at !== null)
        {
            message.expiresAt = row.expires_at.toISOString();
        }

        return message;
    };

    const asReactions = (rows: MessageRow[]) =>
    {
        const on = new Map<string, ChatReaction[]>();

        for (const row of rows)
        {
            if (row.target_id === null || row.body === null || row.epoch === null || row.seq === null || row.iv === null
                || row.sender_device_id === null || row.sender_account_id === null || row.signature === null
                || row.client_at === null || row.commitment === null)
            {
                continue;
            }

            const reaction: ChatReaction = {
                id: row.id,
                conversationId: row.conversation_id,
                kind: row.kind,
                target: row.target_id,
                body: row.body,
                at: row.created_at.toISOString(),
                epoch: row.epoch,
                seq: Number(row.seq),
                iv: row.iv,
                senderDeviceId: row.sender_device_id,
                senderAccountId: row.sender_account_id,
                signature: row.signature,
                clientAt: row.client_at.toISOString(),
                commitment: row.commitment,
                ...(row.sender === null ? {} : { from: row.sender }),
                ...(row.expires_at === null ? {} : { expiresAt: row.expires_at.toISOString() })
            };

            on.set(row.target_id, [...(on.get(row.target_id) ?? []), reaction]);
        }

        return on;
    };

    /**
     * A handle, as the uuid the tables are keyed on.
     *
     * Every person-taking route goes through here, so "the wire speaks handles" is one
     * translation at the edge rather than a rule each route is trusted to remember.
     */
    const mustResolve = async (handle: string) =>
    {
        const row = await social.personByHandle(handle);
        if (row === null)
        {
            throw new NotFoundError('No account with that name.');
        }
        return row.id;
    };

    /**
     * One request, carrying the person on the OTHER end of it.
     *
     * Which end that is depends on the direction: the sender of an incoming request, the recipient
     * of an outgoing one. A request whose counterparty cannot be read - suspended between the two
     * queries - keeps the handles and carries a person built from them, because a request the
     * reader cannot render is a request they cannot answer.
     */
    const asRequest = (
        row: { id: string; from_user: string; to_user: string; created_at: Date },
        handles: Map<string, string>,
        viewer: PersonRow,
        people: Map<string, PersonRow>,
        direction: 'incoming' | 'outgoing'
    ) =>
    {
        const otherId = direction === 'incoming' ? row.from_user : row.to_user;
        const other = people.get(otherId);
        const handle = handles.get(otherId) ?? '';
        return {
            id: row.id,
            from: handles.get(row.from_user) ?? '',
            to: handles.get(row.to_user) ?? '',
            at: row.created_at.toISOString(),
            person: other === undefined
                ? { id: handle, handle, displayName: handle, bio: '', hue: 0, isMinor: false }
                : seenBy(viewer, other, direction)
        };
    };

    const asConversation = (row: ConversationRow) =>
    {
        const summary: ConversationSummary = {
            id: row.id,
            kind: row.kind,
            members: row.members,
            pinned: row.pinned,
            unread: row.unread
        };
        if (row.game !== null)
        {
            summary.game = row.game;
        }
        if (row.title !== null)
        {
            summary.title = row.title;
        }
        if (row.group_slug !== null)
        {
            summary.groupId = row.group_slug;
        }
        if (row.table_id !== null)
        {
            summary.tableId = row.table_id;
        }
        if (row.expire_after !== null)
        {
            summary.expireAfter = row.expire_after;
        }
        if (row.quiet)
        {
            summary.quiet = true;
        }
        if (row.last_id !== null && row.last_at !== null && row.last_kind !== null)
        {
            summary.last = asMessage({
                id: row.last_id,
                conversation_id: row.id,
                kind: row.last_kind,
                body: row.last_body,
                payload: row.last_payload,
                sender: row.last_from,
                sender_account_id: row.last_sender_account_id,
                created_at: row.last_at,
                epoch: row.last_epoch,
                seq: row.last_seq,
                iv: row.last_iv,
                sender_device_id: row.last_sender_device_id,
                signature: row.last_signature,
                client_at: row.last_client_at,
                commitment: row.last_commitment,
                frank: row.last_frank,
                expires_at: row.last_expires_at,
                target_id: null
            });
        }
        return summary;
    };

    const asGroup = (row: GroupRow) =>
    {
        const summary: GroupSummary = {
            id: row.slug,
            slug: row.slug,
            name: row.name,
            blurb: row.blurb,
            crest: row.crest,
            hue: row.hue,
            privacy: row.privacy,
            owner: row.owner ?? '',
            members: row.members,
            memberCount: row.member_count,
            createdAt: row.created_at.toISOString()
        };
        if (row.game !== null)
        {
            summary.game = row.game;
        }
        if (row.role !== null)
        {
            summary.role = row.role;

            // Only a member is given the thread. A non-member holding the id could not read it -
            // `mustBeMember` sees to that - but an id it has no use for is an id it should not
            // have been sent.
            if (row.conversation_id !== null)
            {
                summary.conversationId = row.conversation_id;
            }
        }
        return summary;
    };

    const mustSee = async (me: string, slug: string) =>
    {
        const found = await group.bySlug(me, slug);
        if (found === null)
        {
            throw new NotFoundError('No group there.');
        }
        return found;
    };

    const reread = async (me: string, groupId: string) =>
    {
        const found = await group.byId(me, groupId);
        if (found === null)
        {
            throw new NotFoundError('No group there.');
        }
        return found;
    };

    /**
     * Writes the line that says what just happened, into the group's own thread.
     *
     * `{ key, params }`, never prose - which is what lets it follow a language switch, and what
     * stops a server-authored row from reading like something a person said. An explicit `who`
     * wins over the actor's handle, because "Sara was removed" names Sara while the row records
     * that the owner wrote it.
     *
     * A failed line does not undo the change it describes: the membership is the fact and the
     * announcement is the courtesy, so this is deliberately outside the transaction.
     */
    const announce = async (
        row: GroupRow,
        actor: string | null,
        what: 'created' | 'joined' | 'left' | 'removed' | 'renamed' | 'owner' | 'closed' | 'opened',
        params: Record<string, string>
    ) =>
    {
        if (row.conversation_id === null)
        {
            return;
        }

        const named = params.who ?? (actor === null ? undefined : (await social.handlesOf([actor])).get(actor));
        await chat.post(
            row.conversation_id,
            'system',
            { key: `chat.line.group.${ what }`, params: { ...params, ...(named === undefined ? {} : { who: named }) } },
            actor
        );
    };

    /**
     * The doorbell for a group that changed.
     *
     * Two scopes, not a third: the thread's membership moved (`chat`) and so did everybody's
     * group list (`social`). A `group` scope would carry no information the other two do not
     * already carry, and a wire grows for new information rather than for new vocabulary.
     */
    const ring = async (row: GroupRow, ...also: string[]) =>
    {
        if (row.conversation_id !== null)
        {
            live?.chatChanged(row.conversation_id, ...also);
        }
        live?.socialChanged(...await group.memberIds(row.id), ...also);
    };

    const asTable = (row: TableRow) =>
    {
        const summary: TableSummary = {
            id: row.id,
            code: row.code,
            game: row.game,
            seats: row.seats,
            mode: row.mode,
            privacy: row.privacy,
            target: row.target,
            cube: row.cube,
            blinds: row.blinds,
            chat: row.chat,
            voice: row.voice,
            teams: row.teams,
            status: row.status,
            chairs: row.chairs.map((chair) => ({
                seat: chair.seat,
                ready: chair.ready,
                host: chair.host,
                ...(chair.who === null ? {} : { who: chair.who }),
                ...(chair.invited === null ? {} : { invited: chair.invited })
            })),
            taken: row.taken,
            createdAt: row.created_at.toISOString()
        };

        if (row.host !== null)
        {
            summary.host = row.host;
        }
        if (row.mine !== null)
        {
            summary.mine = row.mine;

            // Only somebody sitting here is given the thread. A non-player holding the id could
            // not read it anyway, and an id with no use is an id that should not have been sent.
            if (row.conversation_id !== null)
            {
                summary.conversationId = row.conversation_id;
            }
        }
        if (row.match_id !== null)
        {
            summary.matchId = row.match_id;
        }
        if (row.last_match_id !== null)
        {
            summary.lastMatchId = row.last_match_id;
        }
        if (row.room_id !== null)
        {
            summary.roomId = row.room_id;
        }
        if (row.removed)
        {
            summary.removed = true;
        }
        if (row.closed_by_staff)
        {
            summary.closedBy = 'staff';
        }
        if (row.quick)
        {
            summary.quick = true;
        }
        if (row.kept_out.length > 0)
        {
            summary.keptOut = row.kept_out;
        }
        if (row.stake !== null)
        {
            summary.stake = row.stake;
        }
        if (row.money !== null)
        {
            summary.money = {
                state: row.money.state,
                feeBps: row.money.feeBps,
                ...(row.money.openTx === null ? {} : { openTx: row.money.openTx }),
                ...(row.money.closeTx === null ? {} : { closeTx: row.money.closeTx }),
                ...(row.money.winners === null ? {} : { winners: seatsOfMask(row.money.winners) }),
                ...(row.money.error === null ? {} : { failed: row.money.error }),
                ...(row.money.blame === null ? {} : { blame: row.money.blame })
            };
        }
        return summary;
    };

    const mustTable = async (me: string, tableId: string) =>
    {
        const found = await table.byId(me, tableId);
        if (found === null)
        {
            throw new NotFoundError('No table there.');
        }
        return found;
    };

    const ringTable = async (row: TableRow, ...also: string[]) =>
    {
        if (row.conversation_id !== null)
        {
            live?.chatChanged(row.conversation_id);
        }
        live?.tableChanged(row.id, [...await table.peopleAt(row.id), ...also]);
    };

    const match = createMatchService(db, achieve);
    const watch = createWatchService(db, (matchId) => match.seatsOf(matchId));

    /**
     * The board as a client is allowed to see it.
     *
     * `turn` and `winner` become SEATS here: the engine counts players by their index in its own
     * array, and that index is meaningless to anybody outside it. `moves` is computed for this
     * viewer only and is empty unless it is their turn - a client is told what it may do, never
     * left to work it out, so an older client renders fewer options rather than an illegal one.
     */
    const asMatch = (load: MatchLoad) =>
    {
        const state = load.state;
        const turn = load.match.finishedAt === null ? match.turnOf(load.match.game, state) : null;

        /**
         * The seats come from `match_players`, not from the engine's state.
         *
         * Who is in a chair, how many turns they have missed and what the match did to their rating
         * are the DATABASE's facts - the same for every game - and reading them off the state meant
         * walking an engine's own player array to find a handle. `turn` and `winner` went the same
         * way: the engine answers the first and `matches.winner_seat` already holds the second,
         * written by the recorder from the judge's plan.
         */
        const view: MatchView = {
            id: load.match.id,
            tableId: load.match.tableId,
            game: load.match.game,
            rev: load.match.rev,
            seats: load.match.seats,
            players: match.envelope(load),
            ...(turn === null ? {} : { turn }),

            /**
             * Composed by the ENGINE, for this viewer, rather than assembled here for everybody.
             *
             * This function used to walk `state.players` and emit every seat's contents to whoever
             * asked - which is safe for ludo, where a board is face up, and is the single thing
             * that would have leaked a hokm hand or a poker hole card the day a second engine
             * landed. The seat goes in; what that seat may know comes out.
             */
            view: match.board(load.match.game, state, load.mine < 0 ? null : load.mine),

            /**
             * Absent, not -1, for somebody with no chair.
             *
             * A watcher is loaded with `mine: -1` because the internal shape needs a number, and
             * putting that on the wire would say "your seat is minus one" to a client that checks
             * whether the field is there. Absence is the answer this product gives everywhere else
             * something is not somebody's - `lastSeenAt` is missing rather than null for a viewer
             * who may not have it - and a client cannot act on a seat it was never given.
             */
            ...(load.mine < 0 ? {} : { mine: load.mine }),
            startedAt: load.match.startedAt.toISOString()
        };

        if (load.match.deadlineAt !== null)
        {
            view.remainingMs = Math.max(0, load.match.deadlineAt.getTime() - Date.now());
        }
        if (load.match.winnerSeat !== null)
        {
            view.winner = load.match.winnerSeat;
        }
        if (load.match.outcome !== null)
        {
            view.outcome = load.match.outcome;
        }
        if (voidedOf(state))
        {
            view.voided = true;
        }
        if (load.match.finishedAt !== null)
        {
            view.finishedAt = load.match.finishedAt.toISOString();
        }

        return view;
    };

    /**
     * The doorbell for a board that moved.
     *
     * A third scope, where groups and tables deliberately reuse two. The objection recorded beside
     * `ringTable` - that a third would be new vocabulary for information `chat` and `social` already
     * carry - does not hold here: a move is genuinely new, `social` fans a presence snapshot to
     * every socket on the server and could not be afforded per roll, and a `chat` nudge would hand
     * the chat store an id it would resolve as a conversation. It stays a doorbell: the frame
     * carries the match id and nothing about the move.
     */
    const shipped = (view: MatchView) => matchView.parse(view);

    const pushMatch = async (matchId: string, before: number) =>
    {
        if (live === undefined)
        {
            return;
        }

        const found = await match.feed(matchId, before);

        if (found === null)
        {
            return;
        }

        const playing = found.load.match.finishedAt === null
            ? found.load.players.filter((row) => row.result === null)
            : found.load.players;

        live.gamePushed(playing.map((row) => ({
            userId: row.user_id,
            match: shipped(asMatch({ ...found.load, mine: row.seat })),
            events: logged(found.events(row.seat))
        })));

        live.gameWatched(found.load.match.tableId, matchId, WATCH_DELAY_MS + 1000, playing.map((row) => row.user_id));
    };

    /**
     * Everything that happens AFTER a move has landed, and none of it may unland it.
     *
     * The move is the fact; the line in the thread and the notification are the courtesy. They run
     * outside the transaction for that reason - and they have to be unable to fail the request for
     * the same one. A stale CHECK constraint on `notifications.kind` turned a perfectly good roll
     * into a 500 the first time this ran: the game had already been played, the row was already
     * written, and the person was told their move failed.
     *
     * It is the rule `wake` already follows for push, and for the identical reason: a courtesy
     * being broken must not make the thing it is a courtesy about broken too. The failure is not
     * swallowed silently - it goes to stderr, which is where an unhandled rejection would have
     * gone anyway.
     */
    const courtesy = (what: string, run: () => Promise<void>): Promise<void> =>
        run().catch((error: unknown) =>
        {
            process.stderr.write(`${ what } failed: ${ error instanceof Error ? error.message : String(error) }\n`);
        });

    const party = createParties({
        registry: createRegistry({
            now: () => Date.now(),

            after(ms, run)
            {
                const timer = setTimeout(run, ms);

                timer.unref();

                return () => clearTimeout(timer);
            },

            ring: (userIds) => void courtesy('party ring', async () =>
            {
                for (const userId of userIds)
                {
                    live?.selfChanged(userId, 'party');
                }
            }),

            id: randomUUID
        }),

        person: async (handle) => (await social.personByHandle(handle))?.id ?? null,

        handles: (userIds) => social.handlesOf(userIds),

        async reaches(a, b)
        {
            try
            {
                const [there, back] = await Promise.all([social.mayMessage(a, b), social.mayMessage(b, a)]);

                return there === null && back === null;
            }
            catch (error)
            {
                if (error instanceof NotFoundError)
                {
                    return false;
                }

                throw error;
            }
        },

        muted: (userId, by, game) => social.hasMuted(userId, [
            { kind: 'person', id: by },
            { kind: 'notice', id: 'invites' satisfies Notice },
            { kind: 'game', id: game }
        ]),

        teamGame: async (game) => (await catalogue.games()).games.some((row) =>
            row.id === game && row.status === 'available' && row.rules.seats.includes(4) && teamsOf(row.rules.partners, 4, true))
    });

    const teamed = (answer: { ok: true } | { ok: false; why: PartyWhy }) =>
    {
        if (!answer.ok)
        {
            throw partyRefused(answer.why);
        }
    };

    const startPushed = async (me: string, tableId: string) =>
    {
        const load = await match.start(me, tableId);

        await courtesy('game push', () => pushMatch(load.match.id, load.match.rev - 1));
        live?.tableChanged(tableId, await table.peopleAt(tableId));

        return load;
    };

    /**
     * Writes the line that says how a game ended, into the table's own thread.
     *
     * Outside the transaction that finished it, exactly like the group lines: the result is the fact
     * and the announcement is the courtesy, so a line that fails to write must not roll back a game
     * somebody won.
     */
    const declareResult = async (matchId: string) =>
    {
        const ending = await endingOf(db, matchId);

        if (ending === null)
        {
            return;
        }

        await chat.post(ending.conversationId, 'result', { key: ending.key, params: ending.params }, null);
        live?.chatChanged(ending.conversationId);
    };

    /**
     * Tells whoever the turn passed to, but only where nobody is watching for it.
     *
     * A `turns` table gives a player twenty-four hours, so without this the product's answer to
     * "whose go is it?" is to keep opening the page - which is not a correspondence game, it is a
     * page somebody has to remember. A `live` table gives forty-five seconds and the person is
     * already looking at the board, so a notification per turn there would be pure noise, and the
     * sweep plays the turn of anybody who walked away.
     *
     * The dedupe key is the MATCH rather than the table, because `table:<id>` is what an invite to
     * the same table already uses - and one key shared by two kinds is two different things
     * collapsing into one row that says neither.
     */
    const nudgeTurn = async (load: MatchLoad, actor: string | null) =>
    {
        const room = await table.roomOf(load.match.tableId);

        if (room === null || room.mode !== 'turns')
        {
            return;
        }

        const key = `turn:${ load.match.id }`;
        const seat = load.match.finishedAt === null ? match.turnOf(load.match.game, load.state) : null;
        const next = load.players.find((one) => one.seat === seat);

        for (const one of load.players)
        {
            if (one.user_id !== next?.user_id)
            {
                await retract(one.user_id, 'turn', key);
            }
        }

        if (next === undefined || next.user_id === actor)
        {
            return;
        }

        await tell({
            userId: next.user_id,
            kind: 'turn',
            actorId: null,
            ref: { tableId: load.match.tableId, game: load.match.game },
            dedupeKey: key
        });
    };

    const vaults = vault ?? createVault({
        rpcUrl: config.rpcUrl,
        chainId: config.chainId,
        vault: config.vaultAddress,
        refereeKey: config.refereeKey
    });

    const vaultAdmin = createVaultAdmin(db, vaults);

    const team = createStaffService(db, config.adminWallet);

    const accounts = createPeopleService(db, config.adminWallet, config.origin);

    const desk = createReportsService(db, config.adminWallet);

    const plays = createPlayService(db, config.adminWallet);

    const onlineNow = createLiveService(db, config.adminWallet);

    const poolOf = () =>
    {
        const pool = (db.driver as unknown as { master?: { totalCount: number; idleCount: number; waitingCount: number } }).master;

        return { total: pool?.totalCount ?? 0, idle: pool?.idleCount ?? 0, waiting: pool?.waitingCount ?? 0 };
    };

    const stuckNow = async () =>
    {
        const live = new Set(await plays.stillLive([...stuckMatches.keys()]));

        for (const id of [...stuckMatches.keys()])
        {
            if (!live.has(id))
            {
                stuckMatches.delete(id);
            }
        }

        return stuckMatches;
    };

    const playNow = async () => ({ games: await plays.games(), stuck: (await stuckNow()).size });

    const roleOf = (row: { address: string | null; staff_role: GrantedRole | null }) =>
        isAdminAddress(row.address, config.adminWallet) ? 'owner' as const : row.staff_role;

    const staffOf = async (me: string) =>
    {
        const row = await identity.profileFor(me);
        const role = row === null || row.is_suspended ? null : roleOf(row);

        return row === null || role === null
            ? null
            : { id: row.id, handle: row.handle, role, address: row.address === null ? null : getAddress(row.address) };
    };

    const ableTo = async (me: string, ability: Ability) =>
    {
        const actor = await staffOf(me);

        return actor !== null && may(actor.role, ability) ? actor : null;
    };

    const stakes = createStakeService(db, vaults, {
        begin: (escrowId) => match.begin(escrowId),

        async began(matchId)
        {
            const load = await match.peek(matchId);

            if (load === null)
            {
                return;
            }

            await courtesy('game push', () => pushMatch(matchId, load.match.rev - 1));
            await courtesy('turn notice', () => nudgeTurn(load, null));
        },

        changed: (tableId, players) => courtesy('table ring', async () =>
        {
            live?.tableChanged(tableId, await table.peopleAt(tableId));

            for (const player of players)
            {
                live?.selfChanged(player, 'vault');
            }
        })
    });

    const walkAway = async (me: string, tableId: string, forfeit: boolean) =>
    {
        const before = await mustTable(me, tableId);
        const people = await table.peopleAt(before.id);

        const { walked } = await table.leave(me, before.id, (tx) => match.walkOut(tx, me, before.id, forfeit));

        if (walked !== null)
        {
            await courtesy('game push', () => pushMatch(walked.matchId, walked.before));

            const load = await match.peek(walked.matchId);

            if (load !== null)
            {
                await courtesy('turn notice', () => nudgeTurn(load, me));
            }

            if (load !== null && load.match.finishedAt !== null)
            {
                await courtesy('result line', () => declareResult(walked.matchId));
                stakes.kick();
            }
        }

        if (before.conversation_id !== null)
        {
            live?.chatChanged(before.conversation_id, me);
        }
        live?.tableChanged(before.id, people);
    };

    const afterVoid = async (matchId: string, ended: { tableId: string; before: number }) =>
    {
        await courtesy('game push', () => pushMatch(matchId, ended.before));

        const load = await match.peek(matchId);

        if (load !== null)
        {
            await courtesy('turn notice', () => nudgeTurn(load, null));
        }

        await courtesy('result line', () => declareResult(matchId));
        live?.tableChanged(ended.tableId, await table.peopleAt(ended.tableId));
        stakes.kick();
    };

    const reportOf = async (id: string) =>
    {
        const found = await desk.find(id);

        if (found === null)
        {
            return null;
        }

        const [together, history] = await Promise.all([
            desk.together(found.row.by_id, found.row.about_id),
            team.ofReport(id)
        ]);

        return { ...found.report, together, history };
    };

    const personOf = async (handle: string) =>
    {
        const found = await accounts.view(handle);

        if (found === null)
        {
            return null;
        }

        const [history, games, paid] = await Promise.all([
            team.about(found.id, null),
            match.history(found.id, null),
            vaults.configured ? stakes.games(found.id, null) : { games: [] }
        ]);

        return {
            ...found.person,
            history: history.rows,
            ...(history.cursor === undefined ? {} : { historyCursor: history.cursor }),
            games: games.matches,
            paidGames: paid.games
        };
    };

    const logged = (events: { rev: number; seat: number; at: Date; log: MatchEventLog['log'] }[]): MatchEventLog[] =>
        events.map((entry) => ({ rev: entry.rev, seat: entry.seat, at: entry.at.toISOString(), log: entry.log }));

    const played = async (
        me: string,
        matchId: string,
        want: { play: MatchPlay | null; key: string; rev?: number }
    ): Promise<{ match: MatchView; applied: 'now' | 'already' | 'stale'; events: MatchEventLog[] }> =>
    {
        const answer = await match.act(me, matchId, want);

        if (answer.applied === 'now')
        {
            await courtesy('game push', () => pushMatch(matchId, answer.before));
            await courtesy('turn notice', () => nudgeTurn(answer.load, me));

            if (answer.load.match.finishedAt !== null)
            {
                await courtesy('result line', () => declareResult(matchId));
                live?.tableChanged(answer.load.match.tableId, await table.peopleAt(answer.load.match.tableId));
                stakes.kick();
            }
        }

        const since = want.rev === undefined ? null : await match.since(me, matchId, want.rev);

        return { match: asMatch(await match.shownTo(answer.load)), applied: answer.applied, events: since === null ? [] : logged(since.events) };
    };

    const TIDY: Record<string, string> = {
        nonces: `delete from siwe_nonces where expires_at < now() - interval '1 day'`,
        recoveryNonces: `delete from recovery_nonces where expires_at < now() - interval '1 day'`,
        sessions: `delete from sessions
                    where expires_at < now() - interval '30 days'
                       or revoked_at < now() - interval '30 days'`,
        pushes: `delete from push_subscriptions where failed_at is not null`
    };

    const otherServers = async () =>
        (await db.query<{ others: number }[]>(
            `select count(distinct application_name)::int as others
               from pg_stat_activity
              where datname = current_database()
                and application_name like 'baziche %'
                and application_name <> current_setting('application_name')`
        ))[0].others;

    const tidy = async () =>
    {
        const gone: Record<string, number> = {};

        for (const [what, sql] of Object.entries(TIDY))
        {
            gone[what] = affectedBy(await db.query(sql));
        }

        return gone;
    };

    const sweepTurns = async (forMs: number): Promise<TurnSweep> =>
    {
        const until = Date.now() + forMs;
        const stuck: TurnSweep['stuck'] = [];
        let played = 0;

        while (Date.now() < until)
        {
            const expired = await match.expireNext();

            if (expired === null)
            {
                break;
            }

            if (!expired.played)
            {
                stuck.push({ matchId: expired.matchId, game: expired.game, reason: expired.reason });

                if (!stuckMatches.has(expired.matchId))
                {
                    stuckMatches.set(expired.matchId, { since: new Date(), kind: stuckKindOf(expired.reason) });
                }

                continue;
            }

            stuckMatches.delete(expired.matchId);
            played += 1;
            await courtesy('game push', () => pushMatch(expired.matchId, expired.before));

            const load = await match.peek(expired.matchId);

            if (load === null)
            {
                continue;
            }

            await courtesy('turn notice', () => nudgeTurn(load, null));

            if (load.match.finishedAt !== null)
            {
                await courtesy('result line', () => declareResult(expired.matchId));
                live?.tableChanged(load.match.tableId, await table.peopleAt(load.match.tableId));
                stakes.kick();
            }
        }

        return { played, stuck };
    };

    let struck: ReadonlySet<string> = new Set<string>();

    const stuckMatches = new Map<string, Stuck>();

    const sweepTables = async (): Promise<TableSweep> =>
    {
        const waiting = await table.waitingSeats(WAITING_SEATS);
        const around = here(waiting.map((seat) => seat.userId));
        const { vacate, next } = strikes(struck, waiting.filter((seat) => !around.has(seat.userId)));
        const failed: TableSweep['failed'] = [];
        let stoodUp = 0;
        let closed = 0;

        struck = next;

        for (const seat of vacate)
        {
            const gone = await table.vacate(seat.tableId, seat.userId, here).catch((error: unknown) =>
            {
                failed.push({ tableId: seat.tableId, reason: error instanceof Error ? error.message : String(error) });

                return null;
            });

            if (gone === null)
            {
                continue;
            }

            stoodUp += 1;
            closed += gone.closed ? 1 : 0;

            await courtesy('table ring', async () =>
            {
                if (gone.conversationId !== null)
                {
                    live?.chatChanged(gone.conversationId, seat.userId);
                }
                live?.tableChanged(seat.tableId, [...await table.peopleAt(seat.tableId), seat.userId]);
            });
        }

        return { stoodUp, closed, failed };
    };

    const peers = createPeerDevices(db);
    const epochs = createEpochService(db);
    const recovery = createRecoveryService(db);

    /**
     * Tells every room this account is in that its recipient set has moved.
     *
     * A doorbell and nothing more, exactly like the rest of `nura-rt/v1`: the frame says the
     * conversation changed and each client re-reads it through the route that already exists. There
     * is no key here to hand anybody - this server holds none - so the only thing it can do about a
     * membership change is make sure nobody misses it.
     */
    const ringRooms = async (userId: string) =>
    {
        if (live === undefined)
        {
            return;
        }

        live.selfChanged(userId, 'devices');

        for (const conversationId of await chat.seatedIn(userId))
        {
            live.chatChanged(conversationId);
        }
    };

    const ringShared = async (me: string, other: string) =>
    {
        if (live === undefined)
        {
            return;
        }

        const theirs = new Set(await chat.seatedIn(other));

        for (const conversationId of await chat.seatedIn(me))
        {
            if (theirs.has(conversationId))
            {
                live.chatChanged(conversationId, me, other);
            }
        }
    };

    const ringProfile = async (userId: string) =>
    {
        if (live === undefined)
        {
            return;
        }

        const [edges, requests] = await Promise.all([social.edgesFor(userId), social.requests(userId)]);
        const parties = [...requests.incoming, ...requests.outgoing].map((request) => request.from_user === userId ? request.to_user : request.from_user);

        live.selfChanged(userId, 'profile');
        live.socialChanged(userId, ...(edges?.friends ?? []), ...parties);

        for (const conversationId of await chat.seatedIn(userId))
        {
            live.chatChanged(conversationId);
        }

        for (const row of await group.mine(userId))
        {
            await ring(row);
        }

        for (const row of await table.mine(userId))
        {
            await ringTable(row);
        }
    };

    /**
     * Folds the join back into one entry per member.
     *
     * The LEFT JOIN gives one row per (member, device) and one null-device row for a member with
     * none. Grouping here rather than in SQL keeps the empty case obvious: the member is created
     * with an empty array the first time their handle is seen, and a null device id simply adds
     * nothing to it.
     */
    const asConversationDevices = (rows: PeerDeviceRow[]): ConversationDevices =>
    {
        const byHandle = new Map<string, ConversationDevices['members'][number]>();

        for (const row of rows)
        {
            let member = byHandle.get(row.handle);
            if (member === undefined)
            {
                member = {
                    accountId: row.account_id,
                    handle: row.handle,
                    ...(row.wallet_address === null ? {} : { address: row.wallet_address }),
                    devices: []
                };
                byHandle.set(row.handle, member);
            }

            // Every proof field is non-null together by CHECK constraint, so one test covers the
            // set; the casts are the compiler catching up with what the database already refuses.
            if (row.device_id !== null && row.attested !== null && row.attested_address !== null)
            {
                member.devices.push({
                    id: row.device_id,
                    exchangeKey: row.exchange_key!,
                    signingKey: row.signing_key!,
                    attested: row.attested,
                    address: row.attested_address,
                    message: row.attested_message!,
                    signature: row.attested_signature!
                });
            }
        }

        return { members: [...byHandle.values()] };
    };

    const device = createDeviceService(db, {
        origin: config.origin,
        chainId: config.chainId,
        rpcUrl: config.rpcUrl
    });

    /**
     * A device as the browser reads it.
     *
     * Both public keys go out, because the client re-derives the id from them on every read and a
     * row it cannot check is a row it has to take on trust. `revoked` is a boolean rather than the
     * timestamp behind it: a date on the wire is a date somebody eventually displays in the wrong
     * timezone.
     */
    const asDevice = (row: DeviceRow): Device => ({
        id: row.id,
        label: row.label,
        exchangeKey: row.exchange_key,
        signingKey: row.signing_key,
        attested: row.attested,
        revoked: row.revoked_at !== null,
        createdAt: row.created_at.toISOString(),
        ...(row.last_seen_at === null ? {} : { lastSeenAt: row.last_seen_at.toISOString() })
    });

    const chain = createChainProfiles({
        rpcUrl: config.rpcUrl,
        registry: config.profileRegistry,
        lens: config.profileLens
    });

    const nfts = createNftReader({ rpcUrl: config.rpcUrl, explorerApi: config.explorerApi });


    const identity = createIdentityService(db, {
        origin: config.origin,
        chainId: config.chainId,
        rpcUrl: config.rpcUrl,
        sessionTtlSeconds: SESSION_TTL_SECONDS,
        vault: config.vaultAddress
    });

    const present = (row: {
        id: string;
        handle: string;
        display_name: string;
        bio: string;
        avatar: string | null;
        hue: number;
        is_minor: boolean;
        address: string | null;
        created_at: Date;
        staff_role: GrantedRole | null;
    }): Account =>
    {
        const role = roleOf(row);

        return {
            id: row.id,
            handle: row.handle,
            displayName: row.display_name,
            bio: row.bio,
            ...(row.avatar === null ? {} : { avatar: row.avatar }),
            hue: row.hue,
            isMinor: row.is_minor,
            joinedAt: row.created_at.toISOString(),
            address: row.address ?? undefined,
            ...(role === null ? {} : { staff: role })
        };
    };

    /**
     * A person, with what the viewer may not know REMOVED rather than flagged.
     *
     * `lastSeenAt` is the only field privacy touches today, and it is omitted - not nulled, not
     * sent with a "don't show this" flag - because a payload the client has to be trusted to
     * filter is a payload one component forgets to filter. If it is not in the JSON, no render
     * path can leak it.
     */
    const seenBy = (viewer: PersonRow, row: PersonRow, relation: Parameters<typeof maySeeOnline>[2]) =>
    {
        const summary: PersonSummary = {
            // The handle, not the uuid. The browser keys people by handle - it is the public
            // identifier, it is what the URL carries, and it is what a message's author is - so
            // the wire says the same thing everywhere rather than two names for one person.
            id: row.handle,
            handle: row.handle,
            displayName: row.display_name,
            bio: row.bio,
            ...(row.avatar === null ? {} : { avatar: row.avatar }),
            hue: row.hue,
            isMinor: row.is_minor
        };

        if (row.last_seen_at !== null && maySeeOnline(social.partyOf(viewer), social.partyOf(row), relation))
        {
            summary.lastSeenAt = row.last_seen_at.toISOString();
        }
        return summary;
    };

    return {
        jobs: { sweepTurns, sweepTables, sweepStakes: (forMs) => stakes.sweep(forMs), waiting: () => table.waitingByGame(), otherServers, tidy, liftSuspensions: () => accounts.expireDue() },

        async pulse()
        {
            const [counts, watching] = await Promise.all([catalogue.live(), table.watchingMark()]);

            return { games: counts.games, watching };
        },

        meta: {
            info: () => ({ wire: 'nura-e2ee/v1', env: config.env })
        },

        catalogue,

        identity: {
            secureCookies,

            async principal(request)
            {
                const token = readSessionToken(request, secureCookies);
                const who = token === null ? null : await identity.principalFor(token);

                if (who !== null)
                {
                    live?.seen(who.userId);
                }

                return who;
            },

            async me(userId)
            {
                const row = await identity.profileFor(userId);
                return row === null ? null : present(row);
            },

            async challenge(address, deviceId)
            {
                if (deviceId !== undefined && !isDeviceId(deviceId))
                {
                    throw new BadRequestError('That is not a device id.');
                }
                const named = deviceId !== undefined && !(await device.liveFor(address, deviceId)) ? deviceId : undefined;
                return identity.challenge(address, named);
            },

            async signInWithWallet(input)
            {
                const result = await identity.signInWithWallet(input);
                const { userId, sessionId } = result.principal;

                if (input.device !== undefined && namesDevice(result.proof.message, input.device.id))
                {
                    try
                    {
                        await device.enrol(userId, sessionId, { ...input.device, userAgent: input.userAgent }, result.proof);
                        await ringRooms(userId);
                    }
                    catch (error)
                    {
                        if (!(error instanceof ConflictError))
                        {
                            throw error;
                        }
                    }
                }

                const row = await identity.profileFor(userId);
                return { token: result.token, account: present(row!) };
            },

            async signOut(sessionId)
            {
                await identity.signOut(sessionId);
                live?.sessionsRevoked([sessionId]);
            },

            async signOutEverywhere(userId)
            {
                const ended = await identity.signOutEverywhere(userId);

                await courtesy('letting go of push subscriptions', () => notify.forgetReach(userId));
                live?.sessionsRevoked(ended);
                return ended.length;
            },
            async claimHandle(userId, handle)
            {
                const claimed = await identity.claimHandle(userId, handle);
                live?.edgesChanged(userId);
                await ringProfile(userId);
                return claimed;
            },

            async setProfile(userId, input)
            {
                const row = await identity.setProfile(userId, input);
                await ringProfile(userId);
                return present(row);
            },

            async uploadAvatar(data)
            {
                return { url: await identity.uploadAvatar(data) };
            },

            avatar: (hash) => identity.avatar(hash)
        },

        vault: {
            state: (me) => stakes.state(me),
            accept: (me) => stakes.accept(me),
            rest: (me, days) => stakes.rest(me, days),
            deposit: (me, amount) => stakes.deposit(me, amount),
            withdraw: (me, amount) => stakes.withdraw(me, amount),
            games: (me, cursor) => stakes.games(me, cursor),
            reclaim: (me, escrowId) => stakes.reclaim(me, escrowId)
        },

        admin: {
            async vault(me)
            {
                const actor = await ableTo(me, 'money');

                return actor === null || actor.address === null ? null : await vaultAdmin.standing(actor.address);
            },

            async fee(me, feeBps)
            {
                const actor = await ableTo(me, 'wallet');

                return actor === null || actor.address === null ? null : await vaultAdmin.fee(actor.address, feeBps);
            },

            async ceiling(me, amount)
            {
                const actor = await ableTo(me, 'wallet');

                return actor === null || actor.address === null ? null : await vaultAdmin.ceiling(actor.address, amount);
            },

            async fees(me, amount)
            {
                const actor = await ableTo(me, 'wallet');

                return actor === null || actor.address === null ? null : await vaultAdmin.fees(actor.address, amount);
            },

            async pause(me, paused)
            {
                const actor = await ableTo(me, 'wallet');

                return actor === null || actor.address === null ? null : await vaultAdmin.pause(actor.address, paused);
            },

            async staff(me)
            {
                return await ableTo(me, 'staff') === null ? null : await team.list();
            },

            async setStaff(me, input)
            {
                const actor = await ableTo(me, 'staff');

                return actor === null ? null : await team.set(actor, input.handle, input.role, input.reason);
            },

            async log(me, query)
            {
                return await ableTo(me, 'log') === null
                    ? null
                    : await team.log({
                        ...(query.staff === undefined ? {} : { staff: query.staff }),
                        ...(query.person === undefined ? {} : { person: query.person }),
                        ...(query.kind === undefined ? {} : { kind: query.kind })
                    }, query.cursor ?? null);
            },

            async people(me, query)
            {
                return await ableTo(me, 'people') === null
                    ? null
                    : await accounts.find({
                        ...(query.q === undefined ? {} : { q: query.q }),
                        ...(query.list === undefined ? {} : { list: query.list }),
                        ...(query.cursor === undefined ? {} : { cursor: query.cursor })
                    });
            },

            async person(me, handle)
            {
                return await ableTo(me, 'people') === null ? null : await personOf(handle);
            },

            async history(me, handle, cursor)
            {
                const id = await ableTo(me, 'people') === null ? null : await accounts.idOf(handle);

                return id === null ? null : await team.about(id, cursor);
            },

            async note(me, handle, input)
            {
                const actor = await ableTo(me, 'people');

                if (actor === null)
                {
                    return null;
                }

                await accounts.note(actor, handle, input.text);
                return await personOf(handle);
            },

            async suspend(me, handle, input)
            {
                const actor = await ableTo(me, 'people');

                if (actor === null)
                {
                    return null;
                }

                const target = await accounts.reachable(actor, handle);

                for (const seat of await table.mine(target.id))
                {
                    await courtesy('suspension forfeit', () => walkAway(target.id, seat.id, true));
                }

                const { id, sessions } = await accounts.suspend(actor, handle, { days: input.days ?? null, category: input.category, reason: input.reason });

                live?.sessionsRevoked(sessions);
                await courtesy('letting go of push subscriptions', () => notify.forgetReach(id));

                return await personOf(handle);
            },

            async lift(me, handle, input)
            {
                const actor = await ableTo(me, 'people');

                if (actor === null)
                {
                    return null;
                }

                await accounts.lift(actor, handle, input.reason);
                return await personOf(handle);
            },

            async clear(me, handle, input)
            {
                const actor = await ableTo(me, 'people');

                if (actor === null)
                {
                    return null;
                }

                const { id, changed } = await accounts.clear(actor, handle, input.part, input.reason);

                if (changed)
                {
                    await courtesy('profile cleared', () => ringProfile(id));
                }

                return await personOf(handle);
            },

            async signOut(me, handle, input)
            {
                const actor = await ableTo(me, 'people');

                if (actor === null)
                {
                    return null;
                }

                const { id, sessions } = await accounts.signOut(actor, handle, input.reason);

                if (sessions.length > 0)
                {
                    live?.sessionsRevoked(sessions);
                    await courtesy('letting go of push subscriptions', () => notify.forgetReach(id));
                }

                return await personOf(handle);
            },

            async minor(me, handle, input)
            {
                const actor = await ableTo(me, 'people');

                if (actor === null)
                {
                    return null;
                }

                const { id, changed } = await accounts.minor(actor, handle, input.minor, input.reason);

                if (input.minor)
                {
                    for (const seat of await table.mine(id))
                    {
                        if (seat.stake !== null && seat.match_id === null)
                        {
                            await courtesy('paid table left', () => walkAway(id, seat.id, false));
                        }
                    }

                    for (const { matchId, ended } of await plays.voidPaid(actor, id, input.reason, match.voidIn))
                    {
                        await afterVoid(matchId, ended);
                    }
                }

                if (changed)
                {
                    await courtesy('party revalidate', () => party.revalidate(id));
                    live?.edgesChanged(id);
                    live?.selfChanged(id, 'vault');
                    await courtesy('profile changed', () => ringProfile(id));
                }

                return await personOf(handle);
            },

            async reports(me, query)
            {
                return await ableTo(me, 'reports') === null ? null : await desk.queue(query.status ?? 'received', query.cursor ?? null);
            },

            async reportsWaiting(me)
            {
                return await ableTo(me, 'reports') === null ? null : { count: await desk.waiting() };
            },

            async report(me, id)
            {
                return await ableTo(me, 'reports') === null ? null : await reportOf(id);
            },

            async review(me, id, input)
            {
                const actor = await ableTo(me, 'reports');
                const found = actor === null ? null : await desk.find(id);

                if (actor === null || found === null)
                {
                    return null;
                }

                await accounts.reachable(actor, found.row.about_handle);

                if (await desk.review(actor, id, input.outcome, input.reason))
                {
                    live?.socialChanged(found.row.by_id);
                }

                return await reportOf(id);
            },

            async play(me)
            {
                return await ableTo(me, 'play') === null ? null : await playNow();
            },

            async switchGame(me, game, input)
            {
                const actor = await ableTo(me, 'play');
                const changed = actor === null ? null : await plays.switchGame(actor, game, input.on, input.reason);

                if (changed === null)
                {
                    return null;
                }

                if (changed)
                {
                    live?.catalogueChanged();
                }

                return await playNow();
            },

            async liveMatches(me, query)
            {
                return await ableTo(me, 'play') === null
                    ? null
                    : await plays.matches(query.list ?? 'all', query.game ?? null, query.cursor ?? null, await stuckNow());
            },

            async waitingTables(me, query)
            {
                return await ableTo(me, 'play') === null ? null : await plays.tables(query.game ?? null, query.cursor ?? null);
            },

            async voidMatch(me, id, input)
            {
                const actor = await ableTo(me, 'play');
                const ended = actor === null ? null : await plays.voidMatch(actor, id, input.reason, match.voidIn);

                if (ended === null)
                {
                    return null;
                }

                await afterVoid(id, ended);

                return await playNow();
            },

            async closeTable(me, id, input)
            {
                const actor = await ableTo(me, 'play');
                const closed = actor === null ? null : await plays.closeTable(actor, id, input.reason, table.shutIn);

                if (closed === null)
                {
                    return null;
                }

                if (closed.conversationId !== null)
                {
                    live?.chatChanged(closed.conversationId);
                }
                live?.tableChanged(id, await table.peopleAt(id));

                return await playNow();
            },

            async overview(me)
            {
                const actor = await ableTo(me, 'overview');

                if (actor === null)
                {
                    return null;
                }

                const [people, games, reports, stuck, money] = await Promise.all([
                    accounts.counts(),
                    plays.games(),
                    desk.waiting(),
                    stuckNow(),
                    may(actor.role, 'money') && vaults.configured ? vaultAdmin.counts() : null
                ]);

                return {
                    at: new Date().toISOString(),
                    people,
                    online: presence?.online?.().length ?? 0,
                    games,
                    stuck: stuck.size,
                    reports,
                    ...(money === null ? {} : { money }),
                    ...(may(actor.role, 'health') && ops !== undefined ? { health: { ...ops.health(), pool: poolOf(), sockets: presence?.sockets?.() ?? 0 } } : {})
                };
            },

            async live(me, query)
            {
                return await ableTo(me, 'live') === null
                    ? null
                    : await onlineNow.now(presence?.online?.() ?? [], presence?.calls?.() ?? [], query.cursor ?? null);
            }
        },

        voice: {
            ice(me)
            {
                const list = (value: string) => value.split(',').map((one) => one.trim()).filter((one) => one !== '');
                const stun = list(config.voiceStunUrls);
                const turn = list(config.voiceTurnUrls);
                const servers: VoiceIce['servers'] = stun.length === 0 ? [] : [{ urls: stun }];

                if (turn.length > 0 && config.voiceTurnSecret !== '')
                {
                    const username = `${ Math.floor(Date.now() / 1000) + TURN_TTL_SECONDS }:${ me }`;
                    const credential = createHmac('sha1', config.voiceTurnSecret).update(username).digest('base64');
                    servers.push({ urls: turn, username, credential });
                }

                return { servers };
            }
        },

        chain: {
            configured: chain.configured,
            registry: chain.registry,
            chainId: config.chainId,

            async profile(userId, lang)
            {
                const row = await identity.profileFor(userId);
                return row === null || row.address === null ? null : chain.profile(row.address, lang);
            },

            async person(handle, lang)
            {
                const subject = await social.personByHandle(handle);
                if (subject === null)
                {
                    return undefined;
                }
                const row = await identity.profileFor(subject.id);
                const held = row === null || row.address === null ? null : await chain.profile(row.address, lang);
                if (held === null)
                {
                    return null;
                }
                return {
                    username: held.username,
                    displayName: held.displayName,
                    bio: held.bio,
                    avatar: avatarHashOf(config.origin, held.avatar) === null ? '' : held.avatar
                };
            },

            async record(userId)
            {
                const row = await identity.profileFor(userId);
                return row === null ? '' : recordValue(await achieve.recordOf(row.handle));
            },

            async publish(userId)
            {
                const row = await identity.profileFor(userId);
                if (row === null || row.address === null)
                {
                    return [];
                }
                return chain.publish({
                    address: row.address,
                    displayName: row.display_name,
                    bio: row.bio,
                    avatar: row.avatar ?? '',
                    record: recordValue(await achieve.recordOf(row.handle))
                });
            },

            async nfts(userId, offset, limit)
            {
                const row = await identity.profileFor(userId);
                if (!nfts.configured || row === null || row.address === null)
                {
                    return { configured: nfts.configured, total: 0, items: [] };
                }
                const held = await nfts.holdings(row.address);
                const slice = held.slice(offset, offset + limit);
                const items = await Promise.all(slice.map(async (one) =>
                {
                    const meta = await nfts.meta(one);
                    return {
                        ...one,
                        name: meta.name,
                        image: meta.image === '' ? '' : `/api/nfts/image/${ one.contract }/${ one.tokenId }`
                    };
                }));
                return { configured: true, total: held.length, items };
            },

            async nftImage(userId, contract, tokenId)
            {
                const row = await identity.profileFor(userId);
                if (!nfts.configured || row === null || row.address === null)
                {
                    return null;
                }
                const wanted = contract.toLowerCase();
                const holding = (await nfts.holdings(row.address))
                    .find((one) => one.contract.toLowerCase() === wanted && one.tokenId === tokenId);
                return holding === undefined ? null : nfts.image(holding);
            }
        },

        social: {
            async graph(me)
            {
                const viewer = await social.person(me);
                if (viewer === null)
                {
                    return { friends: [], incoming: [], outgoing: [], blocked: [], mutes: [] };
                }

                const [friends, requests, blocked, mutes] = await Promise.all([
                    social.friends(me),
                    social.requests(me),
                    social.blocked(me),
                    social.mutes(me)
                ]);

                // A request names two people, and the wire names people by handle - so the two
                // uuids on the row have to be resolved before it leaves.
                const parties = [
                    ...requests.incoming.flatMap((row) => [row.from_user, row.to_user]),
                    ...requests.outgoing.flatMap((row) => [row.from_user, row.to_user])
                ];
                const handles = await social.handlesOf([...parties, ...mutes.filter((one) => one.kind === 'person').map((one) => one.id)]);

                // And the PERSON travels too, because the browser renders the row out of a cache of
                // what this server has sent it. Sending only handles made a request from somebody
                // it had never seen render as nothing at all.
                const others = new Map((await social.peopleOf(parties)).map((row) => [row.id, row]));

                return {
                    // A friend's presence is always visible to them, which is why the relation is
                    // passed as 'friend' rather than looked up again per row.
                    friends: friends.map((row) => seenBy(viewer, row, 'friend')),
                    incoming: requests.incoming.map((row) => asRequest(row, handles, viewer, others, 'incoming')),
                    outgoing: requests.outgoing.map((row) => asRequest(row, handles, viewer, others, 'outgoing')),
                    blocked: blocked.map((row) => seenBy(viewer, row, 'blocked')),
                    mutes: mutes.flatMap((one) =>
                    {
                        if (one.kind !== 'person')
                        {
                            return [one];
                        }

                        const handle = handles.get(one.id);

                        return handle === undefined ? [] : [{ kind: one.kind, id: handle }];
                    })
                };
            },

            async directory(me, limit)
            {
                const viewer = await social.person(me);
                if (viewer === null)
                {
                    return [];
                }
                const people = await social.directory(me, limit);
                const friends = new Set((await social.friends(me)).map((row) => row.id));
                return people.map((row) => seenBy(viewer, row, friends.has(row.id) ? 'friend' : 'none'));
            },

            async search(me, asked, limit)
            {
                const viewer = await social.person(me);
                if (viewer === null)
                {
                    return [];
                }
                const people = await social.search(me, asked, limit);
                const friends = new Set((await social.friends(me)).map((row) => row.id));
                return people.map((row) => seenBy(viewer, row, friends.has(row.id) ? 'friend' : 'none'));
            },

            async suggestions(me, limit)
            {
                const viewer = await social.person(me);
                if (viewer === null)
                {
                    return [];
                }
                const ranked = await social.suggestions(me, limit);
                return ranked.map((entry) => ({ person: seenBy(viewer, entry.person, 'none'), mutual: entry.mutual }));
            },

            async names(handles)
            {
                return (await social.namesOf(handles)).map((row) => ({
                    id: row.handle,
                    handle: row.handle,
                    displayName: row.display_name,
                    bio: row.bio,
                    ...(row.avatar === null ? {} : { avatar: row.avatar }),
                    hue: row.hue,
                    isMinor: row.is_minor
                }));
            },

            async view(me, handle)
            {
                const [viewer, subject] = await Promise.all([social.person(me), social.personByHandle(handle)]);
                if (viewer === null || subject === null)
                {
                    return null;
                }

                const { relation } = await social.relationOf(me, subject.id);
                const mutual = (await social.mutualWith(me, [subject.id])).get(subject.id) ?? 0;
                const refusal = await social.mayMessage(me, subject.id);

                return {
                    person: seenBy(viewer, subject, relation),
                    relation,
                    mutual,
                    joinedAt: subject.created_at.toISOString(),
                    ...(refusal === null ? {} : { refusal })
                };
            },

            // Every one of these moves who may see or reach whom, so every one of them tells the
            // hub - including `setPrivacy` below, which writes the very column `maySeeOnline`
            // reads. A write that forgets leaves a cached edge standing until its ceiling.
            async sendRequest(me, handle)
            {
                const other = await mustResolve(handle);
                const outcome = await social.sendRequest(me, other);

                // Deduped on the SENDER, so asking twice is one notification. A request that was
                // answered by the asking - both sides wanted it - tells the other person they
                // were accepted rather than that they were asked.
                await tell({
                    userId: other,
                    kind: outcome.outcome === 'accepted' ? 'friend-accepted' : 'friend-request',
                    actorId: me,
                    ref: {},
                    dedupeKey: `friend:${ me }`
                });

                if (outcome.outcome === 'accepted')
                {
                    await retract(me, 'friend-request', `friend:${ other }`);
                    live?.edgesChanged(me, other);
                }
                else
                {
                    live?.socialChanged(me, other);
                }
                return outcome;
            },

            async answerRequest(me, requestId, outcome)
            {
                const asker = await social.requesterOf(me, requestId);
                await social.answerRequest(me, requestId, outcome);
                await courtesy('party revalidate', () => party.revalidate(me));

                // Only an acceptance is worth telling somebody about. A decline that announced
                // itself would be a product that makes saying no cost something.
                if (asker === null)
                {
                    live?.socialChanged(me);
                    return;
                }

                if (outcome === 'accepted')
                {
                    await tell({
                        userId: asker,
                        kind: 'friend-accepted',
                        actorId: me,
                        ref: {},
                        dedupeKey: `friend:${ me }`
                    });
                }

                await retract(me, 'friend-request', `friend:${ asker }`);

                if (outcome === 'accepted')
                {
                    live?.edgesChanged(me, asker);
                }
                else
                {
                    live?.socialChanged(me, asker);
                }
            },

            async withdrawRequest(me, handle)
            {
                const other = await mustResolve(handle);
                await social.withdrawRequest(me, other);
                await retract(other, 'friend-request', `friend:${ me }`);
                live?.socialChanged(me, other);
            },

            async removeFriend(me, handle)
            {
                const other = await mustResolve(handle);
                await social.removeFriend(me, other);
                await courtesy('party revalidate', () => party.revalidate(me));
                live?.edgesChanged(me, other);
            },

            async block(me, handle)
            {
                const other = await mustResolve(handle);
                await social.block(me, other);
                await courtesy('party revalidate', () => party.revalidate(me));
                await retract(other, 'friend-request', `friend:${ me }`);
                await retract(me, 'friend-request', `friend:${ other }`);
                live?.edgesChanged(me, other);
                await ringShared(me, other);
            },

            async unblock(me, handle)
            {
                const other = await mustResolve(handle);
                await social.unblock(me, other);
                await courtesy('party revalidate', () => party.revalidate(me));
                live?.edgesChanged(me, other);
                await ringShared(me, other);
            },
            async setMute(me, kind, subjectId, muted)
            {
                if (kind !== 'person')
                {
                    await social.setMute(me, kind, subjectId, muted);
                    return;
                }

                const person = await social.personByHandle(subjectId);

                if (person === null)
                {
                    throw new NotFoundError('That account does not exist.');
                }

                await social.setMute(me, kind, person.id, muted);
            },

            /**
             * Files a report, and CHECKS the disclosure before writing it.
             *
             * Two things have to hold, and they answer different questions. The commitment proves
             * the words are the words - recomputed from the key the reporter disclosed, so a single
             * character changed produces a different value. The frank proves the message passed
             * through this server at all, from that sender in that conversation, because recomputing
             * it needs a key only this server has.
             *
             * A disclosure that fails either is refused rather than stored without its proof: a
             * report moderation cannot check is worse than no report, because somebody will read it
             * anyway and act on it.
             *
             * Membership is checked too. A conversation the reporter is not in answers exactly as
             * one that does not exist, here as everywhere else.
             */
            report: async (me, handle, category, disclosure) =>
            {
                const againstId = await mustResolve(handle);
                const kind = category as Parameters<typeof social.report>[2];

                if (disclosure?.conversationId === undefined || disclosure.messageId === undefined
                    || disclosure.text === undefined || disclosure.frankingKey === undefined)
                {
                    return social.report(me, againstId, kind);
                }

                await chat.mustBeMember(me, disclosure.conversationId);

                const row = await chat.frankedMessage(disclosure.conversationId, disclosure.messageId);

                if (row === null || row.commitment === null || row.frank === null
                    || row.client_at === null || row.sender_device_id === null
                    || row.sender_account_id === null)
                {
                    throw new NotFoundError('No message with that id in this conversation.');
                }

                // The message has to be the reported person's. Franking proves what was said and
                // that it passed through here; it says nothing about WHO is being accused, and
                // without this a report against anybody could carry anybody else's words - a
                // moderator would read a real, verified, correctly-attributed message and act on it
                // against the wrong person. The one thing the whole mechanism exists to prevent.
                if (row.sender_account_id !== againstId)
                {
                    throw new ForbiddenError('That message was not sent by the person being reported.');
                }

                if (!discloses(disclosure.frankingKey, disclosure.text, row.commitment))
                {
                    throw new ForbiddenError('That is not what the message says.');
                }

                const seen = franking.holds({
                    conversationId: disclosure.conversationId,
                    messageId: row.id,
                    senderAccountId: row.sender_account_id,
                    senderDeviceId: row.sender_device_id,
                    clientAt: row.client_at.getTime(),
                    commitment: row.commitment
                }, row.frank);

                if (!seen)
                {
                    throw new ForbiddenError('That message cannot be verified, so it cannot be reported.');
                }

                return social.report(me, againstId, kind, {
                    messageId: row.id,
                    text: disclosure.text,
                    frankingKey: disclosure.frankingKey
                });
            },

            async reports(me)
            {
                const rows = await social.reportsBy(me);
                const handles = await social.handlesOf(rows.map((row) => row.against));
                return rows.map((row) => ({
                    id: row.id,
                    against: handles.get(row.against) ?? '',
                    category: row.category,
                    status: row.status,
                    at: row.created_at.toISOString()
                }));
            },

            async privacy(me)
            {
                const row = await social.person(me);
                if (row === null)
                {
                    return { allowStrangerMessages: false, showOnline: false, isMinor: false };
                }
                return {
                    allowStrangerMessages: row.allow_stranger_messages,
                    showOnline: row.show_online,
                    isMinor: row.is_minor
                };
            },

            async setPrivacy(me, wanted)
            {
                const row = await social.setPrivacy(me, wanted);
                await courtesy('party revalidate', () => party.revalidate(me));
                live?.edgesChanged(me);
                return {
                    allowStrangerMessages: row.allow_stranger_messages,
                    showOnline: row.show_online,
                    isMinor: row.is_minor
                };
            }
        },

        group: {
            async mine(me)
            {
                return (await group.mine(me)).map(asGroup);
            },

            async discover(me, limit)
            {
                return (await group.discover(me, limit)).map(asGroup);
            },

            async view(me, slug)
            {
                const found = await group.bySlug(me, slug);
                return found === null ? null : asGroup(found);
            },

            async create(me, input)
            {
                const made = await group.create(me, {
                    name: input.name,
                    blurb: input.blurb,
                    crest: input.crest,
                    hue: input.hue,
                    game: input.game === '' ? null : input.game,
                    privacy: input.privacy
                });

                await announce(made, me, 'created', {});
                live?.socialChanged(me);
                return asGroup(made);
            },

            async edit(me, slug, input)
            {
                const before = await mustSee(me, slug);
                const after = await group.update(me, before.id, {
                    name: input.name,
                    blurb: input.blurb,
                    crest: input.crest,
                    game: input.game === '' ? null : input.game,
                    privacy: input.privacy
                });

                // A door closing is not something to change behind somebody's back. The same
                // argument the expiry lines are written for: a member who does not know cannot tell
                // "we went private" from "nobody is joining any more".
                if (after.privacy !== before.privacy)
                {
                    await announce(after, me, after.privacy === 'private' ? 'closed' : 'opened', {});
                }

                if (after.name !== before.name)
                {
                    await announce(after, me, 'renamed', { name: after.name });
                }
                await ring(after);
                return asGroup(after);
            },

            async join(me, slug)
            {
                const found = await mustSee(me, slug);
                const arrived = await group.join(me, found.id);

                const after = await reread(me, found.id);
                if (arrived)
                {
                    await announce(after, me, 'joined', {});
                    await ring(after);
                }
                return asGroup(after);
            },

            async leave(me, slug)
            {
                const found = await mustSee(me, slug);
                const members = await group.memberIds(found.id);

                // The line goes in BEFORE the seat does, or it is written into a thread this
                // account has just been removed from - and a conversation it can no longer read.
                await announce(found, me, 'left', {});
                const outcome = await group.leave(me, found.id);

                if (outcome.newOwner !== null)
                {
                    await announce(found, null, 'owner', { who: outcome.newOwner });
                }
                if (found.conversation_id !== null)
                {
                    live?.chatChanged(found.conversation_id, me);
                }
                live?.socialChanged(...members);
                return null;
            },

            async add(me, slug, handle)
            {
                const found = await mustSee(me, slug);
                const other = await social.personByHandle(handle);
                if (other === null)
                {
                    throw new NotFoundError('No account with that name.');
                }

                const arrived = await group.add(me, found.id, other.id);
                const after = await reread(me, found.id);

                if (arrived)
                {
                    await announce(after, me, 'joined', { who: other.handle });
                    await tell({
                        userId: other.id,
                        kind: 'group-added',
                        actorId: me,
                        ref: { groupId: after.slug },
                        dedupeKey: `group:${ after.id }`
                    });
                    await ring(after, other.id);
                }
                return asGroup(after);
            },

            async remove(me, slug, handle)
            {
                const found = await mustSee(me, slug);
                const other = await social.personByHandle(handle);
                if (other === null)
                {
                    throw new NotFoundError('No account with that name.');
                }

                const removed = await group.remove(me, found.id, other.id);
                const after = await reread(me, found.id);

                if (removed)
                {
                    await announce(after, me, 'removed', { who: other.handle });
                    await ring(after, other.id);
                }
                return asGroup(after);
            },

            async transfer(me, slug, handle)
            {
                const found = await mustSee(me, slug);
                const other = await social.personByHandle(handle);
                if (other === null)
                {
                    throw new NotFoundError('No account with that name.');
                }

                await group.transfer(me, found.id, other.id);
                const after = await reread(me, found.id);

                await announce(after, me, 'owner', { who: other.handle });
                await ring(after);
                return asGroup(after);
            }
        },

        table: {
            async quick(me, input)
            {
                const began = performance.now();
                const refused = (error: unknown) =>
                {
                    note?.('quick play refused', { game: input.game, who: me, code: (error as { code?: string }).code ?? 'error' });

                    throw error;
                };
                const nonce = await stakes.signedSearch(me, input).catch(refused);
                const found = await table.quick(
                    me,
                    input,
                    here,
                    (tx) => match.playingAt(tx, me),
                    nonce === null ? undefined : (tx, tableId) => stakes.attach(tx, nonce, tableId)
                ).catch(refused);
                let after = await mustTable(me, found.id);
                const outcome = found.seated ? (after.is_host ? 'opened' : 'joined') : after.match_id === null ? 'already waiting' : 'already playing';

                if (after.status === 'ready' && after.chairs.every((chair) => chair.ready))
                {
                    await courtesy(after.stake === null ? 'quick start' : 'stake lock', async () =>
                    {
                        if (after.stake !== null)
                        {
                            await stakes.lockIfReady(found.id);
                            return;
                        }

                        const load = await startPushed(me, found.id);

                        await courtesy('turn notice', () => nudgeTurn(load, me));
                    });
                    after = await mustTable(me, found.id);
                }

                if (found.seated)
                {
                    await ringTable(after);
                }

                note?.('quick play', {
                    game: after.game,
                    who: me,
                    asked: { seats: input.seats, mode: input.mode, target: input.target, blinds: input.blinds, cube: input.cube, teams: input.teams, stake: input.stake },
                    outcome,
                    table: after.id,
                    match: after.match_id,
                    taken: after.taken,
                    seats: after.seats,
                    away: found.passed?.away ?? 0,
                    missed: found.passed?.missed ?? 0,
                    letGo: found.left?.length ?? 0,
                    ms: Math.round(performance.now() - began)
                });

                for (const gone of found.left ?? [])
                {
                    await courtesy('table ring', async () =>
                    {
                        if (gone.conversationId !== null)
                        {
                            live?.chatChanged(gone.conversationId, me);
                        }
                        live?.tableChanged(gone.tableId, [...await table.peopleAt(gone.tableId), me]);
                    });
                }

                return asTable(after);
            },

            async mine(me)
            {
                const rows = await table.mine(me);
                const turns = await match.turnsAt(me, rows.flatMap((row) => row.match_id === null ? [] : [row.match_id]));

                return rows.map((row) =>
                {
                    const summary = asTable(row);
                    const yourTurn = row.match_id === null ? undefined : turns.get(row.match_id);

                    return yourTurn === undefined ? summary : { ...summary, yourTurn };
                });
            },

            async view(me, tableId)
            {
                const found = await table.byId(me, tableId);

                if (found !== null)
                {
                    live?.tableViewed(me, found.id);
                }
                return found === null ? null : asTable(found);
            },

            async byCode(me, code)
            {
                const found = await table.byCode(me, code);
                return found === null ? null : asTable(found);
            },

            async create(me, input)
            {
                const stake = await stakes.mayOpen(me, input.stake, input.mode);
                const guests = await Promise.all(input.invitees.map((handle) => social.personByHandle(handle)));
                const known = guests.filter((person): person is NonNullable<typeof person> => person !== null);

                const made = await table.create(me, { ...input, invitees: known.map((person) => person.id), stake });
                live?.tableChanged(made.id, [me, ...known.map((person) => person.id)]);

                for (const person of known)
                {
                    await courtesy('invite notice', () => tell({
                        userId: person.id,
                        kind: 'table-invite',
                        actorId: me,
                        ref: { tableId: made.id },
                        dedupeKey: `table:${ made.id }`
                    }));
                }

                /**
                 * A table opened in a room is ANNOUNCED there, and that line is the only way anybody
                 * learns of it.
                 *
                 * A room table is deliberately absent from the global open list - that is the whole
                 * point of it - so without this the host would be sitting alone at a table nobody
                 * else could discover, in the room they opened it for. `courtesy` because the table
                 * is the fact and the announcement is the notice: a failed line must not undo an
                 * opened table.
                 */
                if (made.room_id !== null)
                {
                    const host = await social.person(me);

                    await courtesy('table line', async () =>
                    {
                        await chat.post(
                            made.room_id!,
                            'invite',
                            { key: 'chat.line.table', params: { who: host?.handle ?? '', game: made.game, tableId: made.id } },
                            me
                        );
                        live?.chatChanged(made.room_id!);
                    });
                }

                return asTable(made);
            },

            async claim(me, tableId)
            {
                const seen = await table.byId(me, tableId);

                if (seen !== null && seen.stake !== null && seen.mine === null)
                {
                    await stakes.playerOf(me);
                }

                const seat = await table.claimSeat(me, tableId);
                const after = await mustTable(me, tableId);

                if (seat !== null)
                {
                    await ringTable(after);
                }
                return { table: asTable(after), seat };
            },

            leave: (me, tableId, forfeit) => walkAway(me, tableId, forfeit),

            async setReady(me, tableId, ready, signature)
            {
                const seen = await mustTable(me, tableId);

                if (seen.stake === null)
                {
                    await table.setReady(me, seen.id, ready);
                }
                else if (ready)
                {
                    await stakes.consent(me, seen.id, signature);
                    await courtesy('stake lock', async () =>
                    {
                        await stakes.lockIfReady(seen.id);
                    });
                }
                else
                {
                    await stakes.unready(me, seen.id);
                }

                const after = await mustTable(me, tableId);
                await ringTable(after);
                return asTable(after);
            },

            quickStake: (me, game, stake) => stakes.prepareSearch(me, game, stake),

            async stake(me, tableId)
            {
                const seen = await mustTable(me, tableId);

                return await stakes.prepare(me, seen.id);
            },

            async invite(me, tableId, handle)
            {
                const other = await social.personByHandle(handle);
                if (other === null)
                {
                    throw noInvitee();
                }

                await table.invite(me, tableId, other.id);
                const after = await mustTable(me, tableId);

                await tell({
                    userId: other.id,
                    kind: 'table-invite',
                    actorId: me,
                    ref: { tableId: after.id },
                    dedupeKey: `table:${ after.id }`
                });

                /**
                 * And the table's own thread records who was asked.
                 *
                 * `MessageKind: 'invite'` and `chat.line.invite` were both reserved with nothing
                 * writing either. It goes in the TABLE's room rather than into a direct message,
                 * deliberately: a line in a DM would create a conversation between two people as a
                 * side effect of an invitation, which is a thing nobody asked for. Who was invited
                 * is part of this room's history the way who joined a group is part of that one's.
                 */
                if (after.conversation_id !== null)
                {
                    await courtesy('invite line', async () =>
                    {
                        await chat.post(
                            after.conversation_id!,
                            'invite',
                            { key: 'chat.line.invite', params: { who: handle } },
                            me
                        );
                        live?.chatChanged(after.conversation_id!);
                    });
                }

                await ringTable(after, other.id);
                return asTable(after);
            },

            async remove(me, tableId, handle)
            {
                const gone = await table.remove(me, tableId, handle);
                const after = await mustTable(me, tableId);

                await courtesy('table ring', async () =>
                {
                    if (gone.conversationId !== null)
                    {
                        live?.chatChanged(gone.conversationId, gone.userId);
                    }
                    live?.tableChanged(after.id, [...await table.peopleAt(after.id), gone.userId]);
                });

                await courtesy('removal notice', () => tell({
                    userId: gone.userId,
                    kind: 'table-removed',
                    actorId: me,
                    ref: { tableId: after.id, game: after.game },
                    dedupeKey: `removed:${ after.id }`
                }));

                return asTable(after);
            },

            async close(me, tableId)
            {
                const before = await mustTable(me, tableId);
                const people = await table.peopleAt(before.id);

                await table.close(me, before.id);

                if (before.conversation_id !== null)
                {
                    live?.chatChanged(before.conversation_id);
                }
                live?.tableChanged(before.id, people);
            },

            async setVoice(me, tableId, voice)
            {
                await table.setVoice(me, tableId, voice);
                const after = await mustTable(me, tableId);
                await ringTable(after);
                return asTable(after);
            }
        },

        party: {
            state: (me) => party.state(me),

            async invite(me, handle, game)
            {
                teamed(await party.invite(me, handle, game));

                return party.state(me);
            },

            async accept(me, partyId)
            {
                teamed(await party.accept(me, partyId));

                return party.state(me);
            },

            async decline(me, partyId)
            {
                teamed(party.decline(me, partyId));
            },

            async leave(me, partyId)
            {
                teamed(party.leave(me, partyId));
            }
        },

        match: {
            view: async (me, matchId) =>
            {
                const load = await match.view(me, matchId);

                return load === null ? null : asMatch(load);
            },

            since: async (me, matchId, rev) =>
            {
                const found = await match.since(me, matchId, rev);

                if (found === null)
                {
                    return null;
                }

                return { match: asMatch(found.load), events: logged(found.events) };
            },

            start: async (me, tableId) =>
            {
                const load = await startPushed(me, tableId);

                await courtesy('turn notice', () => nudgeTurn(load, me));

                return asMatch(await match.shownTo(load));
            },

            play: async (me, matchId, input) =>
                await played(me, matchId, { play: input.play, key: input.key, rev: input.rev }),

            resign: async (me, matchId, input) => await played(me, matchId, { play: null, key: input.key }),

            history: (me, cursor) => match.history(me, cursor),

            record: (handle) => achieve.recordOf(handle),
            ladder: (handle, game, family) => achieve.ladderOf(handle, game, family),

            leaderboard: (game, window, after) => achieve.leaderboardOf(game, window, after),

            async watch(me, matchId, rev)
            {
                const found = await watch.delayed(matchId);

                if (found === null)
                {
                    return null;
                }

                /**
                 * Checked whether or not the game is still going.
                 *
                 * It used to be `found.live && ...`, which read as an optimisation and was a hole:
                 * a match that had FINISHED skipped the table check entirely, so any signed-in
                 * caller holding a match id could read the final board of a game played at a
                 * private room table they were never in - the players, the positions and who won.
                 * A game being over does not make the room it was played in public.
                 */
                if (!await table.watchableTable(me, found.load.match.tableId))
                {
                    return null;
                }

                const shown = found.load.match.rev;
                const from = rev === null || !Number.isFinite(rev) ? shown : Math.min(Math.max(Math.trunc(rev), 0), shown);
                const events = shown - from > WATCH_TAIL ? [] : await match.told(found.load, from);

                return { match: asMatch(found.load), behind: found.behind, delay: WATCH_DELAY_MS / 1000, live: found.live, events: logged(events) };
            },

            async proof(me, matchId)
            {
                const played = await match.proof(me, matchId);
                const paid = played === null ? null : await stakes.proofOf(matchId);

                if (played === null || paid === null)
                {
                    return null;
                }

                const who = new Map(played.players.map((player) => [player.seat, player.who]));

                return {
                    game: played.match.game,
                    variant: played.match.variant,
                    seats: played.players.map((player) => player.seat),
                    target: played.table.target,
                    cube: played.table.cube,
                    blinds: played.table.blinds as MatchProof['blinds'],
                    chainId: paid.chainId,
                    vault: paid.vault,
                    amount: paid.escrow.amount,
                    feeBps: paid.escrow.feeBps,
                    state: paid.escrow.state,
                    players: paid.seats.map((seat) => ({
                        seat: seat.seat,
                        who: who.get(seat.seat) ?? '',
                        address: seat.address,
                        commit: seat.commitment,
                        secret: seat.secret,
                        nonce: seat.nonce,
                        deadline: Math.floor(seat.deadline.getTime() / 1000),
                        signature: seat.signature
                    })),
                    actions: played.actions.map((action) => ({
                        rev: action.rev,
                        seat: action.seat,
                        kind: action.kind,
                        payload: JSON.stringify(action.payload),
                        events: JSON.stringify(action.events)
                    })),
                    ...(paid.escrow.openTx === null ? {} : { openTx: paid.escrow.openTx }),
                    ...(paid.escrow.closeTx === null ? {} : { closeTx: paid.escrow.closeTx })
                };
            },

            async watchable(me, game)
            {
                const rows = await table.watchable(me, game, WATCHABLE_MAX);

                return {
                    tables: rows.map((row) => ({
                        id: row.id,
                        code: row.code,
                        game: row.game,
                        seats: row.seats,
                        players: row.players ?? [],
                        startedAt: row.started_at.toISOString()
                    }))
                };
            }
        },

        notify: {
            async page(me, cursor, notice)
            {
                const kinds = notice !== undefined && isNotice(notice)
                    ? Object.keys(NOTICE_OF).filter((kind) => NOTICE_OF[kind] === notice)
                    : null;
                const page = await notify.page(me, decodeCursor(cursor), kinds);
                const oldest = page.items[page.items.length - 1];

                return {
                    items: page.items.map(asNotification),
                    hasMore: page.hasMore,
                    unread: await notify.unread(me),
                    ...(page.hasMore && oldest !== undefined
                        ? { cursor: encodeCursor(oldest.created_at, oldest.id) }
                        : {})
                };
            },

            async markRead(me, id)
            {
                await notify.markRead(me, id);
                live?.selfChanged(me, 'notifications');
            },

            async markAllRead(me)
            {
                await notify.markAllRead(me);
                live?.selfChanged(me, 'notifications');
            },

            async dismiss(me, id)
            {
                await notify.dismiss(me, id);
                live?.selfChanged(me, 'notifications');
            },

            pushKey: () => (vapid === null ? undefined : vapid.publicKey),

            subscribe: (me, input) => notify.subscribe(me, input),
            unsubscribe: (me, endpoint) => notify.unsubscribe(me, endpoint)
        },

        device: {
            async list(me, sessionId)
            {
                const [devices, current] = await Promise.all([
                    device.list(me),
                    device.deviceOfSession(sessionId)
                ]);
                return { devices: devices.map(asDevice), ...(current === null ? {} : { current }) };
            },

            challenge: (me, deviceId) => device.challenge(me, deviceId),

            /**
             * Enrolling changes who this account can be sealed to, so it rings every room it is in:
             * a peer with the thread open re-reads the epoch, sees `stale`, and the next thing anybody
             * says is sealed to the new browser too.
             */
            async enrol(me, sessionId, input)
            {
                const row = await device.enrol(me, sessionId, input);

                await ringRooms(me);
                return asDevice(row);
            },

            async rename(me, deviceId, label)
            {
                const row = await device.rename(me, deviceId, label);
                live?.selfChanged(me, 'devices');
                return asDevice(row);
            },

            /**
             * Revoking has to REACH the device, not merely mark it.
             *
             * The sessions bound to it are revoked in the same transaction, and their sockets are
             * closed here - a revoked device holding a live connection is a device that has not
             * been revoked yet.
             */
            async revoke(me, deviceId)
            {
                const { device: row, sessions } = await device.revoke(me, deviceId);
                if (sessions.length > 0)
                {
                    live?.sessionsRevoked(sessions);
                }

                // The same doorbell, for the opposite reason: this device must stop being wrapped
                // to, and nobody else learns that until they read the epoch again.
                await ringRooms(me);
                return asDevice(row);
            },

            /* ------------------------------------------------------ recovery */

            async recovery(me)
            {
                const vault = await recovery.vaultOf(me);

                return vault === null
                    ? { configured: false }
                    : {
                        configured: true,
                        salt: vault.salt,
                        checkValue: vault.check_value,
                        createdAt: vault.created_at.toISOString()
                    };
            },

            async setRecovery(me, sessionId, input)
            {
                const vault = await recovery.setVault(me, await device.deviceOfSession(sessionId), input);

                return {
                    configured: true,
                    salt: vault.salt,
                    checkValue: vault.check_value,
                    createdAt: vault.created_at.toISOString()
                };
            },

            async clearRecovery(me, sessionId)
            {
                await recovery.clearVault(me, await device.deviceOfSession(sessionId));
            },

            async archive(me, input)
            {
                await recovery.archive(me, input.conversationId, input.epoch, input.wrapped);
            },

            async archived(me)
            {
                return {
                    entries: (await recovery.archived(me)).map((row) => ({
                        conversationId: row.conversation_id,
                        epoch: row.epoch,
                        wrapped: row.wrapped
                    }))
                };
            },

            async recoveryChallenge(me, deviceId)
            {
                return recovery.challenge(me, deviceId);
            },

            restore: (me, input) => recovery.restore(me, input.deviceId, input.nonce, input.signature)
        },

        chat: {
            async list(me, cursor)
            {
                const page = await chat.list(me, listAfter(cursor));
                const unpinned = page.rows.filter((row) => !row.pinned);
                const oldest = unpinned[unpinned.length - 1];

                return {
                    conversations: page.rows.map(asConversation),
                    ...(page.more && oldest !== undefined ? { cursor: listCursorOf(oldest) } : {})
                };
            },

            /**
             * Membership IS the authorisation, exactly as it is for reading the messages.
             *
             * `mustBeMember` throws the same NotFoundError a missing conversation does, so an id
             * cannot be probed for existence by asking who is in it.
             */
            async devices(me, conversationId)
            {
                await chat.mustBeMember(me, conversationId);
                return asConversationDevices(await peers.forConversation(conversationId));
            },

            /**
             * Who could have signed what is in this thread - including devices since revoked.
             *
             * The same guard, because it publishes the same class of fact. What it does NOT do is
             * filter by revocation: a device that signed in March and was signed out in April
             * still signed it, and a reader who cannot check that signature has a thread whose
             * provenance evaporated because somebody replaced a laptop.
             */
            async signers(me, conversationId)
            {
                await chat.mustBeMember(me, conversationId);

                const rows = await peers.signersFor(conversationId);

                return {
                    signers: rows.map((row) => ({
                        accountId: row.account_id,
                        handle: row.handle,
                        id: row.device_id,
                        exchangeKey: row.exchange_key,
                        signingKey: row.signing_key,
                        revoked: row.revoked,
                        attested: row.attested,
                        address: row.attested_address,
                        message: row.attested_message,
                        signature: row.attested_signature
                    }))
                };
            },

            async epoch(me, sessionId, conversationId, epoch, asDeviceId)
            {
                await chat.mustBeMember(me, conversationId);

                const wanted = epoch === undefined ? null : Number(epoch);

                if (wanted !== null && (!Number.isSafeInteger(wanted) || wanted < 1))
                {
                    throw new NotFoundError('That epoch does not exist in this conversation.');
                }

                // The caller names its device and this checks the device is theirs - the same
                // authorisation `mint` does. Falling back to the session's device keeps a browser
                // that has not said which one working, but it is no longer the only way to be
                // answered: a session created by signing in carries no device at all, and a browser
                // that already holds keys is never offered the enrolment that would set one.
                const asking = asDeviceId === undefined
                    ? await device.deviceOfSession(sessionId)
                    : asDeviceId;

                if (asking !== null && asDeviceId !== undefined && await epochs.mine(me, asking) === null)
                {
                    throw new NotFoundError('There is no device of yours under that id.');
                }

                const state = await epochs.state(conversationId, asking, wanted);

                return {
                    ...(state.epoch === null ? {} : {
                        epoch: state.epoch.epoch,
                        mintedBy: state.epoch.minted_by,
                        recipients: state.epoch.recipients,
                        signature: state.epoch.signature,
                        confirmation: state.epoch.confirmation
                    }),
                    ...(state.wrapped === null ? {} : {
                        wrapped: { ephemeralKey: state.wrapped.ephemeral_key, wrapped: state.wrapped.wrapped }
                    }),
                    nextSeq: state.nextSeq,
                    eligible: state.eligible,
                    stale: state.stale
                };
            },

            /**
             * Claims the next epoch for this conversation.
             *
             * The minting device has to be the one this session is signed in on, for the same
             * reason a message has to name its own sender: the commitment is a signature by a
             * device, and a session speaking for a device it is not on is a claim nobody checked.
             */
            async mint(me, sessionId, conversationId, input)
            {
                await chat.mustBeMember(me, conversationId);

                const mine = await device.deviceOfSession(sessionId);
                if (mine === null || mine !== input.mintedBy)
                {
                    throw new ForbiddenError('An epoch has to be minted by the device that is asking.');
                }

                const minted = await epochs.mint(me, conversationId, input);

                if (minted)
                {
                    // Everybody in the thread needs to know there is a new key to fetch before
                    // they can read the next line. The doorbell says the conversation changed;
                    // the store re-reads the epoch through the route that already exists.
                    live?.chatChanged(conversationId);
                }

                return { minted, epoch: input.epoch };
            },

            async messages(me, conversationId, cursor, limit)
            {
                const page = await chat.messages(me, conversationId, decodeCursor(cursor), threadSize(limit));
                const oldest = page.messages[0];
                const reactions = asReactions(page.reactions);
                return {
                    messages: page.messages.map((row) =>
                    {
                        const message = asMessage(row);
                        const on = reactions.get(row.id);
                        return on === undefined ? message : { ...message, reactions: on };
                    }),
                    hasMore: page.hasMore,
                    ...(page.hasMore && oldest !== undefined
                        ? { cursor: encodeCursor(oldest.created_at, oldest.id) }
                        : {})
                };
            },

            async send(me, sessionId, conversationId, input)
            {
                const message = asMessage(
                    await chat.send(me, conversationId, await device.deviceOfSession(sessionId), input)
                );

                if (input.kind === 'reaction')
                {
                    live?.chatChanged(conversationId);
                    return message;
                }

                const told = await notify.tellAll(await chat.recipients(conversationId), {
                    kind: 'message',
                    actorId: me,
                    ref: { conversationId },
                    dedupeKey: `chat:${ conversationId }`
                });

                for (const recipient of told)
                {
                    live?.selfChanged(recipient, 'notifications');
                    wake(recipient);
                }

                live?.chatChanged(conversationId);
                return message;
            },

            async remove(me, conversationId, messageId)
            {
                await chat.remove(me, conversationId, messageId);
                live?.chatChanged(conversationId);
            },

            /**
             * Changes how long messages in this room last, and SAYS SO in the thread.
             *
             * The line is the point. A rule about how long words survive is not something to alter
             * behind somebody's back, and a change nobody can see is one people discover by
             * noticing their history is shorter than they remember.
             */
            async setExpiry(me, conversationId, seconds)
            {
                const set = await chat.setExpiry(me, conversationId, seconds);

                await chat.post(
                    conversationId,
                    'system',
                    set === null
                        ? { key: 'chat.line.expiry.off', params: {} }
                        : { key: 'chat.line.expiry.on', params: { name: String(set) } },
                    me
                );

                live?.chatChanged(conversationId);
                return set;
            },

            async markRead(me, conversationId)
            {
                await chat.markRead(me, conversationId);
                live?.chatSeen(conversationId, me);
            },

            async setPinned(me, conversationId, pinned)
            {
                await chat.setPinned(me, conversationId, pinned);
                live?.chatSeen(conversationId, me);
            },

            async openDirect(me, handle)
            {
                const other = await social.personByHandle(handle);
                if (other === null)
                {
                    throw new NotFoundError('No account with that name.');
                }
                const conversationId = await chat.openDirect(me, other.id);
                live?.chatChanged(conversationId);
                return conversationId;
            }
        }
    };
}
