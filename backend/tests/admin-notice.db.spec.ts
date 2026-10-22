import 'reflect-metadata';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';

import { errorResponse } from '@azerothjs/http';

import { Notice, StaffAction, User, entities } from '../src/entities/index.ts';
import { syncSchema } from '../src/db/schema.ts';
import { seedReference } from '../src/db/seed-reference.ts';
import { buildPorts, type Services, type WriteListener } from '../src/services.ts';

const url = process.env.TEST_DATABASE_URL;

const active = url !== undefined && url !== '';

const WALLETS = [
    '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266',
    '0x70997970c51812dc3a010c7d01b50e0d17dc79c8',
    '0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc',
    '0x90f79bf6eb2c4f870365e785982e1f101e93b906',
    '0x15d34aaf54267db7d7c367839aaf71a00a2c6a65',
    '0x9965507d1a55bcc2695c58ba16fb37d819b0a4dc'
];

const OWNER = 5;

const EN = 'Nura restarts at 22:00 for about ten minutes.';

const FA = 'نورا ساعت ۲۲ حدود ده دقیقه ری‌استارت می‌شه.';

let db: DataSource;
let ports: Services;
let seq = 0;
let changed = 0;

const listener: WriteListener = {
    chatChanged: () => undefined,
    chatSeen: () => undefined,
    socialChanged: () => undefined,
    edgesChanged: () => undefined,
    selfChanged: () => undefined,
    gamePushed: () => undefined,
    gameWatched: () => undefined,
    tableChanged: () => undefined,
    tableViewed: () => undefined,
    catalogueChanged: () =>
    {
        changed += 1;
    },
    sessionsRevoked: () => undefined,
    seen: () => undefined
};

const CONFIG = {
    secret: 'a-test-secret-that-is-long-enough-to-use',
    origin: 'http://localhost:1',
    env: 'test',
    vapidPublicKey: '',
    vapidPrivateKey: '',
    vapidSubject: '',
    adminWallet: WALLETS[OWNER]
} as Parameters<typeof buildPorts>[1];

interface Person
{
    id: string;
    handle: string;
}

const makeUser = async (wallet: number | null): Promise<Person> =>
{
    seq += 1;

    const made = await db.getRepository(User).save({
        handle: `n${ seq }x${ Math.floor(Math.random() * 100000) }`,
        displayName: `Told ${ seq }`,
        hue: seq % 360,
        kind: 'wallet'
    });

    if (wallet !== null)
    {
        await db.query(
            `insert into wallets (user_id, address, chain_id, attestation, last_used_at) values ($1, $2, '31337', 'wallet', now())`,
            [made.id, WALLETS[wallet]]
        );
    }

    return { id: made.id, handle: made.handle };
};

const grant = (owner: Person, target: Person, role: 'moderator' | 'admin') =>
    ports.admin.setStaff(owner.id, { handle: target.handle, role, reason: 'Keeps everybody told' });

const ask = (hours: 1 | 6 | 24 | 72 | 168 = 6, en = EN, fa = FA) => ({ en, fa, hours, reason: 'Maintenance tonight' });

const spanOf = async (id: string) =>
    (await db.query(`select extract(epoch from until - created_at)::int as span from notices where id = $1`, [id]) as { span: number }[])[0].span;

const live = () => db.getRepository(Notice).createQueryBuilder('n').where('n.ended_at is null and n.until > now()').getMany();

const noticeRows = () => db.getRepository(StaffAction).find({ where: { kind: 'notice' }, order: { createdAt: 'ASC' } });

const refusal = async (work: Promise<unknown>) =>
{
    const error = await work.then(() => null, (thrown: unknown) => thrown);

    if (error === null)
    {
        return null;
    }

    const response = errorResponse(error);
    const body = await response.json() as { error: { code: string } };

    return { status: response.status, code: body.error.code };
};

const waitingOnLocks = async () =>
    (await db.query(
        `select count(*)::int as count from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'`
    ) as { count: number }[])[0].count;

describe.skipIf(!active)('the notice everybody sees, against a real database', () =>
{
    beforeAll(async () =>
    {
        db = new DataSource({ type: 'postgres', uuidExtension: 'pgcrypto', url, entities, synchronize: false, logging: ['error'] });
        await db.initialize();
        await syncSchema(db);
        await seedReference(db);
    }, 60_000);

    afterAll(async () =>
    {
        if (db?.isInitialized)
        {
            await db.query('truncate table users cascade');
            await db.destroy();
        }
    });

    beforeEach(async () =>
    {
        ports = buildPorts(db, CONFIG, listener);
        changed = 0;
        await db.query('truncate table users cascade');
    });

    it('puts a notice up for the hours asked, says who put it up, writes one row of the log and rings everybody', async () =>
    {
        const owner = await makeUser(OWNER);
        const admin = await makeUser(1);

        await grant(owner, admin, 'admin');

        const standing = await ports.admin.putNotice(admin.id, ask(6));
        const [row] = await live();

        expect(standing).toEqual({
            notice: { id: row.id, en: EN, fa: FA, until: row.until.toISOString(), at: row.createdAt.toISOString(), by: admin.handle }
        });
        expect(await spanOf(row.id)).toBe(6 * 3600);
        expect(row.staffId).toBe(admin.id);
        expect(await ports.admin.notice(owner.id)).toEqual(standing);
        expect((await noticeRows()).map((one) => [one.staffHandle, one.staffRole, one.personId, one.reason, one.details])).toEqual([
            [admin.handle, 'admin', null, 'Maintenance tonight', { to: 'up', en: EN, fa: FA, hours: '6', until: row.until.toISOString() }]
        ]);
        expect(changed).toBe(1);
    });

    it('carries the notice in the pulse and in the live counts, as nothing but its words, its id and its end', async () =>
    {
        const owner = await makeUser(OWNER);

        expect('notice' in await ports.pulse()).toBe(false);
        expect('notice' in await ports.catalogue.live()).toBe(false);

        await ports.admin.putNotice(owner.id, ask(24));

        const [row] = await live();
        const told = { id: row.id, en: EN, fa: FA, until: row.until.toISOString() };

        expect((await ports.pulse()).notice).toEqual(told);
        expect((await ports.catalogue.live()).notice).toEqual(told);
        expect((await ports.catalogue.live()).games.length).toBeGreaterThan(0);
    });

    it('replaces the notice standing with a new one, so one stands at a time', async () =>
    {
        const owner = await makeUser(OWNER);

        await ports.admin.putNotice(owner.id, ask(6));

        const [first] = await live();
        const standing = await ports.admin.putNotice(owner.id, ask(1, 'Back in five minutes.', 'پنج دقیقه دیگه برمی‌گردیم.'));
        const ended = await db.getRepository(Notice).findOneByOrFail({ id: first.id });
        const now = await live();

        expect(now.map((one) => one.en)).toEqual(['Back in five minutes.']);
        expect(ended.endedAt).not.toBeNull();
        expect(standing?.notice?.en).toBe('Back in five minutes.');
        expect(await spanOf(now[0].id)).toBe(3600);
        expect((await noticeRows()).map((one) => one.details.to)).toEqual(['up', 'up']);
        expect(changed).toBe(2);
    });

    it('takes the notice down early, writes what it said into the log and rings everybody', async () =>
    {
        const owner = await makeUser(OWNER);

        await ports.admin.putNotice(owner.id, ask(72));

        const [row] = await live();

        changed = 0;

        expect(await ports.admin.endNotice(owner.id, { id: row.id, reason: 'The restart is done' })).toEqual({});
        expect(await live()).toEqual([]);
        expect((await db.getRepository(Notice).findOneByOrFail({ id: row.id })).endedAt).not.toBeNull();
        expect(await ports.admin.notice(owner.id)).toEqual({});
        expect('notice' in await ports.pulse()).toBe(false);
        expect((await noticeRows()).map((one) => [one.staffHandle, one.reason, one.details])).toEqual([
            [owner.handle, 'Maintenance tonight', { to: 'up', en: EN, fa: FA, hours: '72', until: row.until.toISOString() }],
            [owner.handle, 'The restart is done', { to: 'down', en: EN, fa: FA }]
        ]);
        expect(changed).toBe(1);
    });

    it('refuses to take down a notice when none stands, and a notice that ran out stands no longer', async () =>
    {
        const owner = await makeUser(OWNER);
        const [old] = await db.query(
            `insert into notices (en, fa, until, created_at) values ('An old line', 'یه خط قدیمی', now() - interval '1 hour', now() - interval '2 hours') returning id`
        ) as { id: string }[];

        expect(await ports.admin.notice(owner.id)).toEqual({});
        expect('notice' in await ports.pulse()).toBe(false);
        expect(await refusal(ports.admin.endNotice(owner.id, { id: old.id, reason: 'Nothing to take down' }))).toEqual({ status: 409, code: 'staff-no-notice' });
        expect(await refusal(ports.admin.endNotice(owner.id, { id: 'not-a-notice', reason: 'Nothing to take down' }))).toEqual({ status: 409, code: 'staff-no-notice' });
        expect(await noticeRows()).toEqual([]);
        expect(changed).toBe(0);

        await ports.admin.putNotice(owner.id, ask(1));

        expect((await db.getRepository(Notice).findOneByOrFail({ id: old.id })).endedAt).toBeNull();
    });

    it('takes down only the notice it names, so one put up meanwhile stays up', async () =>
    {
        const owner = await makeUser(OWNER);
        const admin = await makeUser(1);

        await grant(owner, admin, 'admin');
        await ports.admin.putNotice(owner.id, ask(6));

        const [seen] = await live();

        await ports.admin.putNotice(admin.id, ask(6, 'Back in five minutes.', 'پنج دقیقه دیگه برمی‌گردیم.'));
        changed = 0;

        expect(await refusal(ports.admin.endNotice(owner.id, { id: seen.id, reason: 'The restart is done' }))).toEqual({ status: 409, code: 'staff-no-notice' });
        expect((await live()).map((one) => one.en)).toEqual(['Back in five minutes.']);
        expect((await noticeRows()).map((one) => one.details.to)).toEqual(['up', 'up']);
        expect(changed).toBe(0);
    });

    it('ends a notice no earlier than it began, though the change that ends it began first', async () =>
    {
        const owner = await makeUser(OWNER);
        const later = async () => (await db.query(
            `insert into notices (en, fa, until, created_at) values ('Put up later', 'بعداً گذاشته شد', now() + interval '2 hours', now() + interval '1 minute') returning id`
        ) as { id: string }[])[0].id;
        const ended = async (id: string) => (await db.query(
            `select ended_at >= created_at as after from notices where id = $1`, [id]
        ) as { after: boolean }[])[0].after;

        const replaced = await later();

        await ports.admin.putNotice(owner.id, ask(6));

        const [standing] = await live();
        const named = await later();

        await db.query(`update notices set ended_at = greatest(now(), created_at) where id = $1`, [standing.id]);
        await ports.admin.endNotice(owner.id, { id: named, reason: 'The restart is done' });

        expect(await ended(replaced)).toBe(true);
        expect(await ended(named)).toBe(true);
        expect(await live()).toEqual([]);
    });

    it('shows the newest notice when more than one stands', async () =>
    {
        const owner = await makeUser(OWNER);

        await db.query(
            `insert into notices (en, fa, until, created_at)
             values ('The older line', 'خط قدیمی‌تر', now() + interval '2 hours', now() - interval '2 hours'),
                    ('The newer line', 'خط تازه‌تر', now() + interval '2 hours', now() - interval '1 hour')`
        );

        expect((await ports.admin.notice(owner.id))?.notice?.en).toBe('The newer line');
        expect((await ports.pulse()).notice?.en).toBe('The newer line');
    });

    it('answers a moderator, a player and a suspended admin as a page that is not there, and writes nothing for them', async () =>
    {
        const owner = await makeUser(OWNER);
        const admin = await makeUser(1);
        const moderator = await makeUser(2);
        const player = await makeUser(null);

        await grant(owner, admin, 'admin');
        await grant(owner, moderator, 'moderator');
        await ports.admin.putNotice(owner.id, ask(6));

        const before = await noticeRows();
        const [standing] = await live();

        changed = 0;
        await db.getRepository(User).update({ id: admin.id }, { isSuspended: true });

        for (const who of [moderator, player, admin])
        {
            expect(await ports.admin.notice(who.id)).toBeNull();
            expect(await ports.admin.putNotice(who.id, ask(1, 'Not from me', 'از طرف من نیست'))).toBeNull();
            expect(await ports.admin.endNotice(who.id, { id: standing.id, reason: 'Not from me' })).toBeNull();
        }

        expect((await live()).map((one) => one.en)).toEqual([EN]);
        expect(await noticeRows()).toEqual(before);
        expect(changed).toBe(0);
    });

    it('puts up one notice at a time when two of the staff put one up at once', async () =>
    {
        const owner = await makeUser(OWNER);
        const admin = await makeUser(1);

        await grant(owner, admin, 'admin');

        const gate = db.createQueryRunner();

        await gate.connect();
        await gate.startTransaction();
        await gate.query(`select pg_advisory_xact_lock(hashtext('nura:notice'))`);

        const both = Promise.all([
            ports.admin.putNotice(admin.id, ask(6, 'From the admin', 'از طرف ادمین')),
            ports.admin.putNotice(owner.id, ask(6, 'From the owner', 'از طرف صاحب'))
        ]);
        const deadline = Date.now() + 5000;

        while (await waitingOnLocks() < 2 && Date.now() < deadline)
        {
            await new Promise((resolve) => setTimeout(resolve, 5));
        }

        const parked = await waitingOnLocks();

        await gate.commitTransaction();
        await gate.release();
        await both;

        expect(parked).toBe(2);
        expect(await live()).toHaveLength(1);
        expect((await noticeRows()).map((one) => one.details.to)).toEqual(['up', 'up']);
    });

    it('takes a notice down only once nobody else is changing it', async () =>
    {
        const owner = await makeUser(OWNER);

        await ports.admin.putNotice(owner.id, ask(6));

        const [standing] = await live();
        const gate = db.createQueryRunner();

        await gate.connect();
        await gate.startTransaction();
        await gate.query(`select pg_advisory_xact_lock(hashtext('nura:notice'))`);

        const ending = ports.admin.endNotice(owner.id, { id: standing.id, reason: 'The restart is done' });
        const deadline = Date.now() + 5000;

        while (await waitingOnLocks() < 1 && Date.now() < deadline)
        {
            await new Promise((resolve) => setTimeout(resolve, 5));
        }

        const parked = await waitingOnLocks();

        await gate.commitTransaction();
        await gate.release();

        expect(await ending).toEqual({});
        expect(parked).toBe(1);
        expect(await live()).toEqual([]);
    });
});
