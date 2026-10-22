import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderTest } from '@azerothjs/testing';

import type { StaffRole } from '../../backend/src/domains/admin/roles.ts';
import StaffPage from '../src/pages/admin/staff.page.azeroth';
import '../src/locales/app-catalogue.ts';
import '../src/locales/admin-catalogue.ts';
import { manualClock } from '../src/lib/clock.ts';
import { resetRuntime, setRuntime } from '../src/lib/runtime.ts';
import { useLocale } from '../src/stores/locale.store.ts';
import { useSession } from '../src/stores/session.store.ts';
import { useToasts } from '../src/stores/toasts.store.ts';
import { client, server, staffMember } from './fake-api.ts';

vi.mock('../src/api.ts', async () => await import('./fake-api.ts'));

const NOW = Date.parse('2026-10-22T09:00:00.000Z');

const ALEX = { id: 'u-alex', handle: 'alex', displayName: 'Alex Morgan', bio: '', hue: 32, isMinor: false, address: '0x71c7656ec7ab88b098defb751b7401b5f6d8976f' };

const settle = async () =>
{
    for (let step = 0; step < 16; step += 1)
    {
        await Promise.resolve();
    }
    await new Promise((resolve) => setTimeout(resolve, 30));
};

const as = (staff: StaffRole) =>
{
    useSession().establish({ ...ALEX, staff });
};

const shown = async () =>
{
    const { container } = renderTest(() => StaffPage({}) as unknown as HTMLElement);
    await settle();
    return container;
};

const said = (root: ParentNode, selector: string) => root.querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim() ?? null;

const team = (root: ParentNode) => [...root.querySelectorAll<HTMLElement>('[data-team] [data-member]')].map((row) => `${ row.dataset.member } ${ row.dataset.role }`);

const button = (root: ParentNode, label: string) => [...root.querySelectorAll('button')].find((one) => one.textContent?.trim() === label || one.getAttribute('aria-label') === label);

const typeInto = (field: HTMLInputElement | HTMLTextAreaElement, value: string) =>
{
    field.value = value;
    field.dispatchEvent(new Event('input', { bubbles: true }));
};

const fill = (root: ParentNode, handle: string, role: string | null, reason: string) =>
{
    typeInto(root.querySelector<HTMLInputElement>('#admin-staff-handle')!, handle);

    if (role !== null)
    {
        button(root.querySelector('[role="group"]')!, role)!.click();
    }

    typeInto(root.querySelector<HTMLTextAreaElement>('#admin-staff-reason')!, reason);
};

const toasts = () => useToasts().items().map((one) => one.text);

const ago = (days: number) => new Date(NOW - days * 86_400_000).toISOString();

beforeEach(() =>
{
    cleanup();
    resetRuntime();
    setRuntime({ clock: manualClock(NOW), seed: 5 });
    server.reset();
    useLocale().setLocale('en');
    useSession().reset();
    useToasts().dismissAll();
    as('owner');
});

afterEach(() =>
{
    cleanup();
    vi.restoreAllMocks();
    useSession().reset();
    useLocale().setLocale('en');
});

describe('the staff', () =>
{
    it('lists the owner apart, then the admins before the moderators, with who made each and when', async () =>
    {
        server.staff.members = [
            staffMember('mina', 'moderator', 'alex', ago(1)),
            staffMember('sara.k', 'admin', 'alex', ago(3))
        ];
        const container = await shown();

        const owner = said(container, '[data-owner] [data-member="alex"]') ?? '';

        expect([owner.includes('Alex Morgan'), owner.includes('@alex'), owner.includes('Owner')]).toEqual([true, true, true]);
        expect(team(container)).toEqual(['sara.k admin', 'mina moderator']);
        expect([said(container, '[data-member="sara.k"] [data-made] span span'), said(container, '[data-member="sara.k"] [data-by]'), said(container, '[data-member="sara.k"] [data-when]')]).toEqual(['By', 'alex', '3 days ago']);
        expect(container.querySelector('[data-member="sara.k"] [data-by]')?.getAttribute('dir')).toBe('ltr');
        expect(said(container, '[data-member="mina"]')).toContain('Moderator');
    });

    it('puts the team and the form side by side once there is room, the form held in view while the team scrolls', async () =>
    {
        server.staff.members = [staffMember('mina', 'moderator', 'alex', ago(1))];
        const container = await shown();
        const split = container.querySelector<HTMLElement>('[data-split]')!;
        const [team, form] = [...split.children] as HTMLElement[];

        expect(split.className).toContain('@4xl:grid-cols-[minmax(0,1fr)_22rem]');
        expect(split.closest('.\\@container')).not.toBeNull();
        expect(split.children).toHaveLength(2);
        expect(team?.querySelector('[data-team] [data-member="mina"]')).not.toBeNull();
        expect(form?.tagName).toBe('SECTION');
        expect(form?.getAttribute('aria-labelledby')).toBe('admin-staff-form');
        expect(form?.className).toContain('@4xl:sticky');
    });

    it('lets a row put its role and its change on a line of their own before it cuts a name short', async () =>
    {
        server.staff.members = [staffMember('mina', 'moderator', 'alex', ago(1))];
        const container = await shown();
        const row = container.querySelector<HTMLElement>('[data-member="mina"]')!;
        const acts = row.querySelector<HTMLElement>('[data-acts]')!;

        expect(row.classList.contains('flex-wrap')).toBe(true);
        expect(acts.parentElement).toBe(row);
        expect(acts.classList.contains('ms-auto')).toBe(true);
        expect(acts.textContent?.trim()).toBe('ModeratorChange');
        expect(row.firstElementChild?.classList.contains('min-w-48')).toBe(true);
        expect(row.firstElementChild?.querySelector('[dir="auto"]')?.textContent).toBe('Mina Sadeghi');
    });

    it('says when nobody else is on the staff, and when the staff could not be read', async () =>
    {
        const lonely = await shown();

        expect(lonely.textContent).toContain('Nobody else is on the staff yet.');
        expect(lonely.querySelector('[data-empty]')).not.toBeNull();
        expect(lonely.querySelector('.empty-art')).toBeNull();
        cleanup();

        server.staff.owner = 'sara.k';
        as('moderator');
        const refused = await shown();

        expect(refused.textContent).toContain('The staff could not be read.');
        expect(refused.querySelector('[data-team]')).toBeNull();
    });

    it('offers the owner every role and an admin only a moderator, and a change only on somebody below the reader', async () =>
    {
        server.staff.members = [staffMember('sara.k', 'admin', 'alex', ago(3)), staffMember('mina', 'moderator', 'alex', ago(1))];
        const owner = await shown();
        const roles = (root: ParentNode) => [...root.querySelectorAll('[role="group"] button')].map((one) => one.textContent?.trim());

        expect(roles(owner)).toEqual(['Moderator', 'Admin', 'No role']);
        expect(button(owner, 'Change Sara Kamali’s role')).toBeDefined();
        expect(button(owner, 'Change Mina Sadeghi’s role')).toBeDefined();
        expect(owner.querySelector('[data-owner] button')).toBeNull();
        cleanup();

        server.staff.owner = 'reza.t';
        server.staff.members = [staffMember('alex', 'admin', 'reza.t', ago(5)), ...server.staff.members];
        as('admin');
        const admin = await shown();

        expect(roles(admin)).toEqual(['Moderator', 'No role']);
        expect(button(admin, 'Change Sara Kamali’s role')).toBeUndefined();
        expect(button(admin, 'Change Alex Morgan’s role')).toBeUndefined();
        expect(button(admin, 'Change Mina Sadeghi’s role')).toBeDefined();
    });

    it('shows a new member at the press, says so once the server has, and empties the form', async () =>
    {
        let answer: () => void = () => undefined;
        const sent = vi.spyOn(client.admin, 'setStaff');
        sent.mockImplementationOnce(async (request) =>
        {
            await new Promise<void>((resolve) => answer = resolve);
            return await client.admin.setStaff(request);
        });
        const container = await shown();

        fill(container, '@Mina', 'Admin', '  Runs the Friday tables.  ');
        button(container, 'Save')!.click();
        await settle();

        expect(team(container)).toEqual(['mina admin']);
        expect(sent).toHaveBeenCalledWith({ input: { handle: 'mina', role: 'admin', reason: 'Runs the Friday tables.' } });
        expect(toasts()).toEqual([]);

        answer();
        await settle();

        expect(team(container)).toEqual(['mina admin']);
        expect([said(container, '[data-member="mina"] [data-by]'), said(container, '[data-member="mina"] [data-when]')]).toEqual(['alex', 'now']);
        expect(toasts()).toEqual(['mina is an admin now.']);
        expect(container.querySelector<HTMLInputElement>('#admin-staff-handle')!.value).toBe('');
        expect(container.querySelector<HTMLTextAreaElement>('#admin-staff-reason')!.value).toBe('');
        expect(server.staff.log.map((row) => `${ row.kind } ${ row.person } ${ row.details.to }`)).toEqual(['grant mina admin']);
    });

    it('takes a change back when the server refuses it, says why in the reader\'s words, and keeps what was typed', async () =>
    {
        server.staff.members = [staffMember('mina', 'moderator', 'alex', ago(1))];
        const container = await shown();

        fill(container, 'nobody.here', 'Moderator', 'A typo, as it happens.');
        button(container, 'Save')!.click();
        await settle();

        expect(team(container)).toEqual(['mina moderator']);
        expect(toasts()).toEqual(['No one by that name.']);
        expect(container.querySelector<HTMLInputElement>('#admin-staff-handle')!.value).toBe('nobody.here');
        expect(container.querySelector<HTMLTextAreaElement>('#admin-staff-reason')!.value).toBe('A typo, as it happens.');

        useToasts().dismissAll();
        fill(container, 'alex', 'Admin', 'Trying my own role.');
        button(container, 'Save')!.click();
        await settle();

        expect(toasts()).toEqual(['The owner is named in the server’s .env, and changed only there.']);
        expect(server.staff.log).toEqual([]);
    });

    it('asks for a handle and a real reason before it sends anything', async () =>
    {
        const container = await shown();
        const before = server.calls.length;

        fill(container, '  ', null, ' ok ');
        button(container, 'Save')!.click();
        await settle();

        expect(said(container, '#admin-staff-handle-error')).toBe('Type the handle of the person.');
        expect(said(container, '#admin-staff-reason-error')).toBe('Say why, in three characters or more.');
        expect(server.calls.slice(before)).toEqual([]);
    });

    it('takes somebody off the staff at the press, and moves the form to whoever Change was pressed for', async () =>
    {
        server.staff.members = [staffMember('sara.k', 'admin', 'alex', ago(3)), staffMember('mina', 'moderator', 'alex', ago(1))];
        const container = await shown();

        button(container, 'Change Mina Sadeghi’s role')!.click();

        expect(container.querySelector<HTMLInputElement>('#admin-staff-handle')!.value).toBe('mina');
        expect(container.querySelector('[role="group"] [aria-pressed="true"]')?.textContent?.trim()).toBe('Moderator');
        expect(document.activeElement?.textContent?.trim()).toBe('Moderator');

        button(container.querySelector('[role="group"]')!, 'No role')!.click();
        typeInto(container.querySelector<HTMLTextAreaElement>('#admin-staff-reason')!, 'Moved away.');
        button(container, 'Save')!.click();

        expect(team(container)).toEqual(['sara.k admin']);

        await settle();

        expect(team(container)).toEqual(['sara.k admin']);
        expect(toasts()).toEqual(['mina is off the staff.']);
        expect(server.staff.log.map((row) => `${ row.kind } ${ row.person } ${ row.details.from }`)).toEqual(['revoke mina moderator']);
    });

    it('says it all in Persian', async () =>
    {
        useLocale().setLocale('fa');
        server.staff.members = [staffMember('mina', 'moderator', 'alex', ago(1))];
        const container = await shown();

        expect(said(container, 'h1')).toBe('تیم');
        expect(said(container, '[data-member="mina"]')).toContain('ناظر');
        expect([...container.querySelectorAll('[role="group"] button')].map((one) => one.textContent?.trim())).toEqual(['ناظر', 'ادمین', 'بدون نقش']);

        fill(container, 'sara.k', 'ادمین', 'مسئول میزهای جمعه.');
        button(container, 'ثبت')!.click();
        await settle();

        expect(toasts()).toEqual(['sara.k حالا ادمینه.']);
    });
});
