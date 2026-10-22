import 'reflect-metadata';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DataSource } from 'typeorm';

import { errorResponse } from '@azerothjs/http';

import { StaffAction, StaffMember, User, entities } from '../src/entities/index.ts';
import { syncSchema } from '../src/db/schema.ts';
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
    catalogueChanged: () => undefined,
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
    adminWallet: WALLETS[OWNER].toUpperCase().replace('0X', '0x')
} as Parameters<typeof buildPorts>[1];

let db: DataSource;
let ports: Services;
let seq = 0;

interface Person
{
    id: string;
    handle: string;
}

const makeUser = async (wallet: number, overrides: Partial<Pick<User, 'isSuspended'>> = {}): Promise<Person> =>
{
    seq += 1;

    const made = await db.getRepository(User).save({
        handle: `s${ seq }x${ Math.floor(Math.random() * 100000) }`,
        displayName: `Staffer ${ seq }`,
        hue: seq % 360,
        kind: 'wallet',
        ...overrides
    });

    await db.query(
        `insert into wallets (user_id, address, chain_id, attestation, last_used_at) values ($1, $2, '31337', 'wallet', now())`,
        [made.id, WALLETS[wallet]]
    );

    return { id: made.id, handle: made.handle };
};

const word = async (work: Promise<unknown>) =>
{
    const thrown = await work.then(() => null, (error: unknown) => error);

    if (thrown === null)
    {
        return null;
    }

    const response = errorResponse(thrown);
    const body = await response.json() as { error: { code: string; message: string } };

    return `${ response.status } ${ body.error.code }`;
};

const set = (actor: Person, target: { handle: string }, role: 'moderator' | 'admin' | 'none', reason = 'Runs the evening tables') =>
    ports.admin.setStaff(actor.id, { handle: target.handle, role, reason });

const roles = async () =>
    Object.fromEntries((await db.getRepository(StaffMember).find()).map((row) => [row.userId, row.role]));

const logged = async () =>
    (await db.getRepository(StaffAction).find({ order: { createdAt: 'DESC', id: 'DESC' } }))
        .map((row) => [row.kind, row.staffHandle, row.staffRole, row.personHandle, row.reason, row.details]);

describe.skipIf(!active)('the staff, against a real database', () =>
{
    beforeAll(async () =>
    {
        db = new DataSource({ type: 'postgres', uuidExtension: 'pgcrypto', url, entities, synchronize: false, logging: ['error'] });
        await db.initialize();
        await syncSchema(db);
    }, 60_000);

    afterAll(async () =>
    {
        if (db?.isInitialized)
        {
            await db.getRepository(StaffAction).createQueryBuilder().delete().execute();
            await db.destroy();
        }
    });

    beforeEach(async () =>
    {
        ports = buildPorts(db, CONFIG, listener);
        await db.getRepository(StaffAction).createQueryBuilder().delete().execute();
        await db.getRepository(User).createQueryBuilder().delete().execute();
    });

    describe('who is on the staff', () =>
    {
        it('says on the account which role somebody holds, the owner by the wallet the server names, and nothing for a player', async () =>
        {
            const owner = await makeUser(OWNER);
            const admin = await makeUser(1);
            const player = await makeUser(2);

            await set(owner, admin, 'admin');

            expect((await ports.identity.me(owner.id))?.staff).toBe('owner');
            expect((await ports.identity.me(admin.id))?.staff).toBe('admin');
            expect(await ports.identity.me(player.id)).not.toHaveProperty('staff');
        });

        it('answers a player, a moderator and a suspended admin as nothing, on every staff port', async () =>
        {
            const owner = await makeUser(OWNER);
            const player = await makeUser(0);
            const moderator = await makeUser(1);
            const suspended = await makeUser(2);

            await set(owner, moderator, 'moderator');
            await set(owner, suspended, 'admin');
            await db.getRepository(User).update({ id: suspended.id }, { isSuspended: true });

            for (const somebody of [player, moderator, suspended])
            {
                expect(await ports.admin.staff(somebody.id)).toBeNull();
                expect(await ports.admin.setStaff(somebody.id, { handle: owner.handle, role: 'moderator', reason: 'Trying it' })).toBeNull();
                expect(await ports.admin.log(somebody.id, {})).toBeNull();
                expect(await ports.admin.vault(somebody.id)).toBeNull();
            }

            expect(await logged()).toHaveLength(2);
        });

        it('lists the owner apart, then the admins before the moderators, with who made each one', async () =>
        {
            const owner = await makeUser(OWNER);
            const admin = await makeUser(0);
            const moderator = await makeUser(1);
            const second = await makeUser(2);

            await set(owner, moderator, 'moderator');
            await set(owner, admin, 'admin');
            await set(admin, second, 'moderator');

            const list = await ports.admin.staff(owner.id);

            expect(list?.owner).toMatchObject({ handle: owner.handle, role: 'owner' });
            expect(list?.owner).not.toHaveProperty('grantedBy');
            expect(list?.members.map((member) => [member.handle, member.role, member.grantedBy])).toEqual([
                [admin.handle, 'admin', owner.handle],
                [moderator.handle, 'moderator', owner.handle],
                [second.handle, 'moderator', admin.handle]
            ]);
            expect(list?.members.every((member) => typeof member.grantedAt === 'string')).toBe(true);
            expect(await ports.admin.staff(admin.id)).toEqual(list);
        });
    });

    describe('changing who is on the staff', () =>
    {
        it('grants, changes and revokes, each writing one row of the log with its reason', async () =>
        {
            const owner = await makeUser(OWNER);
            const admin = await makeUser(0);
            const moderator = await makeUser(1);

            await set(owner, admin, 'admin', 'Runs the weekend');
            await set(admin, moderator, 'moderator', 'Watches the Persian chats');
            await set(owner, moderator, 'admin', 'Has done it well for a month');
            await set(owner, admin, 'none', 'Stepped away');

            expect(await roles()).toEqual({ [moderator.id]: 'admin' });
            expect(await logged()).toEqual([
                ['revoke', owner.handle, 'owner', admin.handle, 'Stepped away', { from: 'admin' }],
                ['change', owner.handle, 'owner', moderator.handle, 'Has done it well for a month', { from: 'moderator', to: 'admin' }],
                ['grant', admin.handle, 'admin', moderator.handle, 'Watches the Persian chats', { to: 'moderator' }],
                ['grant', owner.handle, 'owner', admin.handle, 'Runs the weekend', { to: 'admin' }]
            ]);
        });

        it('refuses an admin anything at or above an admin, and writes nothing', async () =>
        {
            const owner = await makeUser(OWNER);
            const admin = await makeUser(0);
            const other = await makeUser(1);
            const moderator = await makeUser(2);

            await set(owner, admin, 'admin');
            await set(owner, other, 'admin');
            await set(owner, moderator, 'moderator');

            const before = [await roles(), await logged()];

            expect(await word(set(admin, (await makeUser(3)), 'admin'))).toBe('409 staff-rank');
            expect(await word(set(admin, other, 'none'))).toBe('409 staff-rank');
            expect(await word(set(admin, other, 'moderator'))).toBe('409 staff-rank');
            expect(await word(set(admin, moderator, 'admin'))).toBe('409 staff-rank');
            expect([await roles(), await logged()]).toEqual(before);
        });

        it('refuses a change to oneself, to the owner, and to somebody who is not there, a suspended account in the same words', async () =>
        {
            const owner = await makeUser(OWNER);
            const admin = await makeUser(0);
            const suspended = await makeUser(1, { isSuspended: true });

            await set(owner, admin, 'admin');

            expect(await word(set(admin, admin, 'moderator'))).toBe('409 staff-self');
            expect(await word(set(admin, owner, 'none'))).toBe('409 staff-owner');
            expect(await word(set(owner, owner, 'admin'))).toBe('409 staff-owner');

            const missing = await set(owner, { handle: 'nobody-here' }, 'moderator').then(() => null, (error: unknown) => errorResponse(error));
            const hidden = await set(owner, suspended, 'moderator').then(() => null, (error: unknown) => errorResponse(error));

            expect(missing?.status).toBe(404);
            expect(await hidden?.text()).toBe(await missing?.text());
            expect(await logged()).toHaveLength(1);
        });

        it('writes nothing when the role asked for is the role already held, or none for somebody who holds none', async () =>
        {
            const owner = await makeUser(OWNER);
            const admin = await makeUser(0);
            const player = await makeUser(1);

            await set(owner, admin, 'admin');
            await set(owner, admin, 'admin');
            await set(owner, player, 'none');

            expect(await logged()).toHaveLength(1);
        });

        it('takes two changes to one person one after the other, each with its row', async () =>
        {
            const owner = await makeUser(OWNER);
            const admin = await makeUser(0);
            const target = await makeUser(1);

            await set(owner, admin, 'admin');
            await Promise.all([set(owner, target, 'moderator'), set(admin, target, 'moderator')]);

            const rows = (await logged()).filter((row) => row[3] === target.handle);

            expect(rows).toHaveLength(1);
            expect(await roles()).toMatchObject({ [target.id]: 'moderator' });

            await Promise.all([set(owner, target, 'admin'), set(owner, target, 'none')]);

            const kinds = (await logged()).filter((row) => row[3] === target.handle).map((row) => row[0]).sort();
            const revokedLast = kinds.includes('change');

            expect(kinds).toEqual(revokedLast ? ['change', 'grant', 'revoke'] : ['grant', 'grant', 'revoke']);
            expect((await roles())[target.id] ?? 'none').toBe(revokedLast ? 'none' : 'admin');
        });
    });

    describe('the log', () =>
    {
        it('reads newest first, a page at a time, and by staff member, person or kind, whatever the case of the handle', async () =>
        {
            const owner = await makeUser(OWNER);
            const admin = await makeUser(0);
            const target = await makeUser(1);

            await set(owner, admin, 'admin');
            await db.getRepository(StaffAction).insert(Array.from({ length: 55 }, (_, index) => ({
                staffId: admin.id,
                staffHandle: admin.handle,
                staffRole: 'admin' as const,
                kind: index % 2 === 0 ? 'grant' as const : 'revoke' as const,
                personId: target.id,
                personHandle: target.handle,
                reason: `Row ${ index }`,
                details: {},
                createdAt: new Date(Date.UTC(2026, 9, 1, 12, Math.floor(index / 5)))
            })));

            const first = await ports.admin.log(owner.id, {});
            const second = await ports.admin.log(owner.id, first?.cursor === undefined ? {} : { cursor: first.cursor });

            expect(first?.rows).toHaveLength(50);
            expect(first?.cursor).toBeDefined();
            expect(second?.rows).toHaveLength(6);
            expect(second).not.toHaveProperty('cursor');

            const all = [...(first?.rows ?? []), ...(second?.rows ?? [])];

            expect(new Set(all.map((row) => row.id)).size).toBe(56);
            expect(all.map((row) => row.at)).toEqual([...all.map((row) => row.at)].sort().reverse());

            expect((await ports.admin.log(owner.id, { staff: owner.handle.toUpperCase() }))?.rows.map((row) => row.reason)).toEqual(['Runs the evening tables']);
            expect((await ports.admin.log(owner.id, { person: target.handle, kind: 'grant' }))?.rows).toHaveLength(28);
            expect((await ports.admin.log(owner.id, { cursor: 'not|a-cursor' }))?.rows).toHaveLength(50);
        });
    });
});
