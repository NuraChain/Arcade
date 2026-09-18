import { ForbiddenError, NotFoundError } from '@azerothjs/http';
import type { DataSource } from 'typeorm';

import { createCatalogueService } from './domains/catalogue/service.ts';
import { createChatService, type ConversationRow, type MessageRow } from './domains/chat/service.ts';
import { createFranking, discloses } from './domains/chat/franking.ts';
import { createEpochService } from './domains/chat/epochs.ts';
import { createPeerDevices, type PeerDeviceRow } from './domains/device/peers.ts';
import { createRecoveryService } from './domains/device/recovery-service.ts';
import { createDeviceService, type DeviceRow } from './domains/device/service.ts';
import { createGroupService, type GroupRow } from './domains/group/service.ts';
import { createNotifyService, type NotificationRow } from './domains/notify/service.ts';
import { sendPush, type VapidKeys } from './domains/notify/push.ts';
import { createAchieveService } from './domains/achieve/service.ts';
import { endingOf } from './domains/match/declare.ts';
import { createMatchService, type MatchLoad } from './domains/match/service.ts';
import { WATCH_DELAY_MS, createWatchService } from './domains/match/watch.ts';
import { createTableService, type TableRow } from './domains/table/service.ts';
import { createIdentityService } from './domains/identity/service.ts';
import { maySeeOnline } from './domains/social/policy.ts';
import { createSocialService, type PersonRow } from './domains/social/service.ts';
import type { ServerConfig } from './env.ts';
import { readSessionToken, SESSION_TTL_SECONDS } from './http/auth.ts';
import type { Ports } from './ports.ts';
import type {
    Account,
    ChatMessage,
    ConversationDevices,
    ConversationSummary,
    Device,
    GroupSummary,
    Notification,
    PersonSummary,
    MatchView,
    TableSummary
} from './schemas.ts';

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
    chatChanged(conversationId: string): void;
    socialChanged(...userIds: string[]): void;
    gameChanged(matchId: string, players: readonly string[]): void;
    sessionsRevoked(sessionIds: readonly string[]): void;
}

/**
 * Everything the composition root gets: the ports the API may call, plus the periodic work.
 *
 * `Ports` is the CLIENT-SAFE contract - `api.ts` imports it as a type and the browser's typecheck
 * program follows - so a sweep that only the server runs does not belong in it. It belongs here,
 * where `main.ts` already reaches, and the api still takes the narrower thing.
 */
export interface Services extends Ports
{
    jobs: {
        /** Plays the turns whose deadline has passed. Answers how many it played. */
        sweepTurns(limit: number): Promise<number>;
    };
}

export function buildPorts(db: DataSource, config: ServerConfig, live?: WriteListener): Services
{
    // Secure cookies require TLS, and the browser silently drops a Secure cookie on plain http -
    // which in development is every request. Decided from configuration, never from a header a
    // caller controls.
    const secureCookies = config.origin.startsWith('https://');

    const social = createSocialService(db);
    const franking = createFranking(config.secret);
    const chat = createChatService(db, social, franking);
    const group = createGroupService(db, social);
    const achieve = createAchieveService(db);
    const table = createTableService(db, social, achieve);
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
    const wake = (userId: string): void =>
    {
        if (vapid === null)
        {
            return;
        }

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
        })().catch(() => undefined);
    };

    /** Tells somebody, then wakes them if they asked to be woken. */
    const tell = async (input: {
        userId: string;
        kind: Notification['kind'];
        actorId: string | null;
        ref: Record<string, string>;
        dedupeKey: string;
    }): Promise<void> =>
    {
        if (await notify.tell(input))
        {
            wake(input.userId);
        }
    };

    const asNotification = (row: NotificationRow): Notification =>
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
    const encodeCursor = (at: Date, id: string): string =>
        Buffer.from(`${ at.toISOString() }|${ id }`, 'utf8').toString('base64url');

    const decodeCursor = (cursor: string | undefined): { at: Date; id: string } | null =>
    {
        if (cursor === undefined || cursor === '')
        {
            return null;
        }
        const [at, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
        const when = new Date(at ?? '');
        return id === undefined || Number.isNaN(when.getTime()) ? null : { at: when, id };
    };

    const asMessage = (row: MessageRow): ChatMessage =>
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

    /**
     * A handle, as the uuid the tables are keyed on.
     *
     * Every person-taking route goes through here, so "the wire speaks handles" is one
     * translation at the edge rather than a rule each route is trusted to remember.
     */
    const mustResolve = async (handle: string): Promise<string> =>
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

    const asConversation = (row: ConversationRow): ConversationSummary =>
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
                expires_at: row.last_expires_at
            });
        }
        return summary;
    };

    const asGroup = (row: GroupRow): GroupSummary =>
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

    const mustSee = async (me: string, slug: string): Promise<GroupRow> =>
    {
        const found = await group.bySlug(me, slug);
        if (found === null)
        {
            throw new NotFoundError('No group there.');
        }
        return found;
    };

    const reread = async (me: string, groupId: string): Promise<GroupRow> =>
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
    ): Promise<void> =>
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
    const ring = async (row: GroupRow, ...also: string[]): Promise<void> =>
    {
        if (row.conversation_id !== null)
        {
            live?.chatChanged(row.conversation_id);
        }
        live?.socialChanged(...await group.memberIds(row.id), ...also);
    };

    const asTable = (row: TableRow): TableSummary =>
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
        if (row.room_id !== null)
        {
            summary.roomId = row.room_id;
        }
        return summary;
    };

    const mustTable = async (me: string, tableId: string): Promise<TableRow> =>
    {
        const found = await table.byId(me, tableId);
        if (found === null)
        {
            throw new NotFoundError('No table there.');
        }
        return found;
    };

    /**
     * The doorbell for a table that changed.
     *
     * The same two scopes groups use, for the same reason: the table thread's membership moved
     * (`chat`) and so did everybody's list of where they are sitting (`social`). A third scope
     * would be new vocabulary for information these two already carry.
     */
    const ringTable = async (row: TableRow, ...also: string[]): Promise<void> =>
    {
        if (row.conversation_id !== null)
        {
            live?.chatChanged(row.conversation_id);
        }
        live?.socialChanged(...await table.seatedIds(row.id), ...also);
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
    /**
     * The half of a seat that is only there once there is something to say.
     *
     * `result` exists after a match ends; the rating pair exists only when the match MOVED one, so
     * a room that emptied carries a result and no numbers. Spread rather than set to null, because
     * an absent field and a null are different answers and the wire shape says optional.
     */
    const seatExtras = (load: MatchLoad, seat: number): Partial<MatchView['players'][number]> =>
    {
        const row = load.players.find((one) => one.seat === seat);

        if (row === undefined)
        {
            return {};
        }

        return {
            ...(row.result == null ? {} : { result: row.result as 'won' | 'lost' | 'abandoned' }),
            ...(row.rating_before == null || row.rating_after == null
                ? {}
                : { ratingBefore: row.rating_before, ratingAfter: row.rating_after })
        };
    };

    const asMatch = (load: MatchLoad): MatchView =>
    {
        const state = load.state;
        const seatOf = (index: number): number => state.players[index].seat;

        const view: MatchView = {
            id: load.match.id,
            tableId: load.match.tableId,
            game: load.match.game,
            rev: load.match.rev,
            seats: load.match.seats,
            players: state.players.map((player) => ({
                seat: player.seat,
                who: load.players.find((row) => row.seat === player.seat)?.who ?? '',
                timeouts: load.players.find((row) => row.seat === player.seat)?.timeouts ?? 0,
                ...seatExtras(load, player.seat)
            })),
            turn: seatOf(state.turn),

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
            view.deadline = load.match.deadlineAt.toISOString();
        }
        if (state.winner !== null)
        {
            view.winner = seatOf(state.winner);
        }
        if (load.match.outcome !== null)
        {
            view.outcome = load.match.outcome;
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
    const ringMatch = async (matchId: string): Promise<void> =>
    {
        live?.gameChanged(matchId, await match.playersOf(matchId));
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

    /**
     * Writes the line that says how a game ended, into the table's own thread.
     *
     * Outside the transaction that finished it, exactly like the group lines: the result is the fact
     * and the announcement is the courtesy, so a line that fails to write must not roll back a game
     * somebody won.
     */
    const declareResult = async (matchId: string): Promise<void> =>
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
    const nudgeTurn = async (load: MatchLoad): Promise<void> =>
    {
        if (load.match.finishedAt !== null)
        {
            return;
        }

        const room = await table.roomOf(load.match.tableId);

        if (room === null || room.mode !== 'turns')
        {
            return;
        }

        const seat = load.state.players[load.state.turn]?.seat;
        const next = load.players.find((one) => one.seat === seat);

        if (next === undefined)
        {
            return;
        }

        await tell({
            userId: next.user_id,
            kind: 'turn',
            actorId: null,
            ref: { tableId: load.match.tableId },
            dedupeKey: `turn:${ load.match.id }`
        });
    };

    const played = async (
        me: string,
        matchId: string,
        want: { kind: 'roll' | 'move' | 'resign'; key: string; rev?: number; piece?: number }
    ): Promise<{ match: MatchView; applied: 'now' | 'already' | 'stale' }> =>
    {
        const answer = await match.act(me, matchId, want);

        if (answer.applied === 'now')
        {
            await ringMatch(matchId);

            if (answer.load.match.finishedAt === null)
            {
                await courtesy('turn notice', () => nudgeTurn(answer.load));
            }
            else
            {
                await courtesy('result line', () => declareResult(matchId));
                live?.socialChanged(...await match.playersOf(matchId));
            }
        }

        return { match: asMatch(answer.load), applied: answer.applied };
    };

    /**
     * Plays the turns that ran out, and is the FIRST caller `match.due`/`match.expire` have ever had.
     *
     * Both were written, tested against a real Postgres and wired to nothing - so a turn that
     * expired was never played, no seat was ever forfeited, and a table somebody walked away from
     * sat on its deadline forever while this file's own notes described the sweep in the present
     * tense.
     *
     * `skip locked` inside `due` is what makes two ticks safe: a match another pass already holds is
     * one this pass should look past, which is the exact opposite of the `for update` an action
     * takes. Each expiry is rung and declared on its own rather than in a batch, because one that
     * throws must not take the rest of the tick with it.
     */
    const sweepTurns = async (limit: number): Promise<number> =>
    {
        let swept = 0;

        for (const matchId of await match.due(limit))
        {
            if (!await match.expire(matchId))
            {
                continue;
            }

            swept += 1;
            await ringMatch(matchId);

            const load = await match.peek(matchId);

            if (load === null)
            {
                continue;
            }

            if (load.match.finishedAt === null)
            {
                await courtesy('turn notice', () => nudgeTurn(load));
            }
            else
            {
                await courtesy('result line', () => declareResult(matchId));
                live?.socialChanged(...await match.playersOf(matchId));
            }
        }

        return swept;
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
    const ringRooms = async (userId: string): Promise<void> =>
    {
        if (live === undefined)
        {
            return;
        }

        for (const conversationId of await chat.seatedIn(userId))
        {
            live.chatChanged(conversationId);
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
                    kind: row.kind,
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
     * row it cannot check is a row it has to take on trust. `confirmed` and `revoked` are booleans
     * rather than the timestamps behind them: nothing renders when a device was confirmed, and a
     * date on the wire is a date somebody eventually displays in the wrong timezone.
     */
    const asDevice = (row: DeviceRow): Device => ({
        id: row.id,
        label: row.label,
        exchangeKey: row.exchange_key,
        signingKey: row.signing_key,
        attested: row.attested,
        confirmed: row.confirmed_at !== null,
        revoked: row.revoked_at !== null,
        createdAt: row.created_at.toISOString(),
        ...(row.last_seen_at === null ? {} : { lastSeenAt: row.last_seen_at.toISOString() })
    });

    const identity = createIdentityService(db, {
        origin: config.origin,
        chainId: config.chainId,
        rpcUrl: config.rpcUrl,
        sessionTtlSeconds: SESSION_TTL_SECONDS
    });

    const present = (row: {
        id: string;
        handle: string;
        display_name: string;
        bio: string;
        hue: number;
        kind: 'wallet' | 'guest';
        is_minor: boolean;
        address: string | null;
    }): Account => ({
        id: row.id,
        handle: row.handle,
        displayName: row.display_name,
        bio: row.bio,
        hue: row.hue,
        kind: row.kind,
        isMinor: row.is_minor,
        address: row.address ?? undefined
    });

    /**
     * A person, with what the viewer may not know REMOVED rather than flagged.
     *
     * `lastSeenAt` is the only field privacy touches today, and it is omitted - not nulled, not
     * sent with a "don't show this" flag - because a payload the client has to be trusted to
     * filter is a payload one component forgets to filter. If it is not in the JSON, no render
     * path can leak it.
     */
    const seenBy = (viewer: PersonRow, row: PersonRow, relation: Parameters<typeof maySeeOnline>[2]): PersonSummary =>
    {
        const summary: PersonSummary = {
            // The handle, not the uuid. The browser keys people by handle - it is the public
            // identifier, it is what the URL carries, and it is what a message's author is - so
            // the wire says the same thing everywhere rather than two names for one person.
            id: row.handle,
            handle: row.handle,
            displayName: row.display_name,
            bio: row.bio,
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
        jobs: { sweepTurns },

        meta: {
            info: () => ({ wire: 'nura-e2ee/v1', env: process.env.NODE_ENV ?? 'development' })
        },

        catalogue: createCatalogueService(db),

        identity: {
            secureCookies,

            async principal(request)
            {
                const token = readSessionToken(request, secureCookies);
                return token === null ? null : identity.principalFor(token);
            },

            async me(userId)
            {
                const row = await identity.profileFor(userId);
                return row === null ? null : present(row);
            },

            challenge: (address) => identity.challenge(address),

            async signInWithWallet(input)
            {
                const result = await identity.signInWithWallet(input);
                const row = await identity.profileFor(result.principal.userId);
                return { token: result.token, account: present(row!) };
            },

            async signInAsGuest(input)
            {
                const result = await identity.signInAsGuest(input);
                const row = await identity.profileFor(result.principal.userId);
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

                // Every socket this account holds, not only the one that asked. Signing out
                // everywhere that leaves a live socket open is the feature not working.
                live?.socialChanged(userId);
                live?.sessionsRevoked(ended);
                return ended.length;
            },
            claimHandle: (userId, handle) => identity.claimHandle(userId, handle),

            async setProfile(userId, input)
            {
                const row = await identity.setProfile(userId, input);

                // The display name travels on every person payload the social graph sends, so
                // everybody with this account on screen has to be told to re-read it.
                live?.socialChanged(userId);
                return present(row);
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
                const handles = await social.handlesOf(parties);

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
                    mutes
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

                live?.socialChanged(me, other);
                return outcome;
            },

            async answerRequest(me, requestId, outcome)
            {
                const asker = await social.requesterOf(me, requestId);
                await social.answerRequest(me, requestId, outcome);

                // Only an acceptance is worth telling somebody about. A decline that announced
                // itself would be a product that makes saying no cost something.
                if (outcome === 'accepted' && asker !== null)
                {
                    await tell({
                        userId: asker,
                        kind: 'friend-accepted',
                        actorId: me,
                        ref: {},
                        dedupeKey: `friend:${ me }`
                    });
                }

                live?.socialChanged(me);
            },

            async withdrawRequest(me, handle)
            {
                const other = await mustResolve(handle);
                await social.withdrawRequest(me, other);
                live?.socialChanged(me, other);
            },

            async removeFriend(me, handle)
            {
                const other = await mustResolve(handle);
                await social.removeFriend(me, other);
                live?.socialChanged(me, other);
            },

            async block(me, handle)
            {
                const other = await mustResolve(handle);
                await social.block(me, other);
                live?.socialChanged(me, other);
            },

            async unblock(me, handle)
            {
                const other = await mustResolve(handle);
                await social.unblock(me, other);
                live?.socialChanged(me, other);
            },
            setMute: (me, kind, subjectId, muted) => social.setMute(me, kind, subjectId, muted),

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
                live?.socialChanged(me);
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
                if (!outcome.deleted)
                {
                    live?.chatChanged(found.conversation_id ?? '');
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
            async open(me, game, limit)
            {
                return (await table.open(me, game ?? null, limit)).map(asTable);
            },

            async mine(me)
            {
                return (await table.mine(me)).map(asTable);
            },

            async view(me, tableId)
            {
                const found = await table.byId(me, tableId);
                return found === null ? null : asTable(found);
            },

            async byCode(me, code)
            {
                const found = await table.byCode(me, code);
                return found === null ? null : asTable(found);
            },

            async create(me, input)
            {
                const guests = await Promise.all(input.invitees.map((handle) => social.personByHandle(handle)));
                const known = guests.filter((person): person is NonNullable<typeof person> => person !== null);

                const made = await table.create(me, { ...input, invitees: known.map((person) => person.id) });
                live?.socialChanged(me, ...known.map((person) => person.id));

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
                const seat = await table.claimSeat(me, tableId);
                const after = await mustTable(me, tableId);

                if (seat !== null)
                {
                    await ringTable(after);
                }
                return { table: asTable(after), seat };
            },

            async leave(me, tableId)
            {
                const before = await mustTable(me, tableId);
                const seated = await table.seatedIds(before.id);

                await table.leave(me, before.id);

                if (before.conversation_id !== null)
                {
                    live?.chatChanged(before.conversation_id);
                }
                live?.socialChanged(...seated);
            },

            async setReady(me, tableId, ready)
            {
                await table.setReady(me, tableId, ready);
                const after = await mustTable(me, tableId);
                await ringTable(after);
                return asTable(after);
            },

            async invite(me, tableId, handle)
            {
                const other = await social.personByHandle(handle);
                if (other === null)
                {
                    throw new NotFoundError('No account with that name.');
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

            async close(me, tableId)
            {
                const before = await mustTable(me, tableId);
                const seated = await table.seatedIds(before.id);

                await table.close(me, before.id);

                if (before.conversation_id !== null)
                {
                    live?.chatChanged(before.conversation_id);
                }
                live?.socialChanged(...seated);
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

                return {
                    match: asMatch(found.load),
                    events: found.events.map((entry) => ({
                        rev: entry.rev,
                        seat: entry.seat,
                        at: entry.at.toISOString(),
                        log: entry.log
                    }))
                };
            },

            start: async (me, tableId) =>
            {
                const load = await match.start(me, tableId);

                await ringMatch(load.match.id);
                live?.socialChanged(...await table.seatedIds(tableId));

                return asMatch(load);
            },

            roll: async (me, matchId, input) => await played(me, matchId, { kind: 'roll', key: input.key, rev: input.rev }),

            move: async (me, matchId, input) => await played(me, matchId, { kind: 'move', key: input.key, rev: input.rev, piece: input.piece }),

            resign: async (me, matchId, input) => await played(me, matchId, { kind: 'resign', key: input.key }),

            history: (me, cursor) => match.history(me, cursor),

            record: (handle) => achieve.recordOf(handle),

            leaderboard: (game, window) => achieve.leaderboardOf(game, window),

            /**
             * Two refusals that are deliberately the same answer.
             *
             * A table a stranger may not watch and a match that does not exist both come back null,
             * which the route turns into 404 - the chat domain's rule, because a 403 confirms the
             * table is there and the point is that a stranger cannot tell a closed door from a typo.
             * A match too YOUNG to have a board old enough is the third null and reads the same from
             * here; the client says "the game has just started" from `live` and an absent board.
             */
            async watch(me, matchId)
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

                return { match: asMatch(found.load), behind: found.behind, delay: WATCH_DELAY_MS / 1000, live: found.live };
            },

            async watchable(me, game)
            {
                const rows = await table.watchable(me, game, 12);

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
            async page(me, cursor)
            {
                const page = await notify.page(me, decodeCursor(cursor));
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

            markRead: (me, id) => notify.markRead(me, id),
            markAllRead: (me) => notify.markAllRead(me),
            dismiss: (me, id) => notify.dismiss(me, id),

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
             * Enrolling can make an account sealable, so it rings the rooms too.
             *
             * An account's FIRST device is confirmed at birth, which is exactly the change `confirm`
             * below rings for - the account goes from "nothing to wrap a key to" to eligible. Without
             * this, a peer with the thread open goes on being told this person has not given any of
             * their browsers keys until something else makes them refetch, and the person who just
             * enrolled cannot be written to in the meantime.
             *
             * A later device arrives pending and changes nothing anybody can seal to, so the doorbell
             * is redundant rather than wrong: whoever hears it re-reads and finds the same set.
             */
            async enrol(me, sessionId, input)
            {
                const row = await device.enrol(me, sessionId, input);

                await ringRooms(me);
                return asDevice(row);
            },

            /**
             * Confirming a device makes it ELIGIBLE, which changes every room this account is in.
             *
             * Rotation is the client's to perform and the server's to notice, so all this can do is
             * ring the doorbell: everybody with one of these threads open re-reads the epoch, sees
             * `stale`, and the next person to say something mints. Without it a peer would go on
             * sealing to a set that no longer includes this device until something else happened to
             * make them refetch, and the new device would be unable to read any of it.
             */
            async confirm(me, sessionId, deviceId)
            {
                const caller = await device.deviceOfSession(sessionId);
                const row = await device.confirm(me, caller, deviceId);

                await ringRooms(me);
                return asDevice(row);
            },

            async rename(me, deviceId, label)
            {
                return asDevice(await device.rename(me, deviceId, label));
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

            /**
             * Confirming by phrase changes who this account can be sealed to, exactly as confirming
             * by another device does - so it rings the same rooms. A recovered browser that nobody
             * had been told about would sit there unable to read anything new.
             */
            async recoverDevice(me, input)
            {
                const answer = await recovery.confirm(me, input.deviceId, input.nonce, input.signature);

                await ringRooms(me);
                return answer;
            }
        },

        chat: {
            async list(me)
            {
                return (await chat.list(me)).map(asConversation);
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

            async messages(me, conversationId, cursor)
            {
                const page = await chat.messages(me, conversationId, decodeCursor(cursor));
                const oldest = page.messages[0];
                return {
                    messages: page.messages.map(asMessage),
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

                // One notification per conversation, counting up. Twelve messages while somebody
                // was away is one row saying twelve, not twelve rows to swipe through - and the
                // count resets when they read it, because that is what reading it means.
                for (const recipient of await chat.recipients(conversationId))
                {
                    if (recipient !== me)
                    {
                        await tell({
                            userId: recipient,
                            kind: 'message',
                            actorId: me,
                            ref: { conversationId },
                            dedupeKey: `chat:${ conversationId }`
                        });
                    }
                }

                live?.chatChanged(conversationId);
                return message;
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

                // Nobody is excluded, including the person who just read it: their OTHER tabs are
                // the ones that would otherwise keep showing the badge.
                live?.chatChanged(conversationId);
            },

            async setPinned(me, conversationId, pinned)
            {
                await chat.setPinned(me, conversationId, pinned);
                live?.chatChanged(conversationId);
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
