import { ApiError } from '../api.ts';
import { isStaffRefusal } from '../../../backend/src/domains/admin/refusals.ts';
import { STAFF_ROLES, type StaffRole } from '../../../backend/src/domains/admin/roles.ts';
import { normalizeName } from '../../../backend/src/lib/naming.ts';
import type { StaffLog } from '../../../backend/src/schemas.ts';
import type { MessageKey } from '../locales/en.ts';
import type { LocaleApi } from '../stores/locale.store.ts';

export type LogRow = StaffLog['rows'][number];

export const ROLE_WORDS: Record<StaffRole, MessageKey> = {
    owner: 'admin.role.owner',
    admin: 'admin.role.admin',
    moderator: 'admin.role.moderator'
};

const ROLE_IN: Record<StaffRole, MessageKey> = {
    owner: 'admin.role.in.owner',
    admin: 'admin.role.in.admin',
    moderator: 'admin.role.in.moderator'
};

const isRole = (value: string | undefined): value is StaffRole => STAFF_ROLES.some((role) => role === value);

export const foldHandle = (typed: string) => normalizeName(typed.trim().replace(/^@/, ''));

export const whyStaffRefused = (error: unknown) => (error instanceof ApiError && isStaffRefusal(error.code) ? `admin.refused.${ error.code }` as const : 'common.actionFailed');

const SLOT = /(\{[a-z]+\})/;

const slotOf = (part: string) => /^\{([a-z]+)\}$/.exec(part)?.[1] ?? null;

export function handleParts(said: string, handles: Readonly<Record<string, string>>)
{
    return said
        .split(SLOT)
        .filter((part) => part !== '')
        .map((part, at) =>
        {
            const slot = slotOf(part);
            const handle = slot !== null && Object.hasOwn(handles, slot) ? handles[slot] : undefined;

            return handle === undefined ? { at, text: part, handle: false } : { at, text: handle, handle: true };
        });
}

const said = (row: LogRow, locale: LocaleApi) =>
{
    const named = (role: string | undefined) => (isRole(role) ? locale.t(ROLE_IN[role]) : role ?? '');
    const slots = { staff: '{staff}', person: '{person}' };

    if (row.kind === 'grant')
    {
        return locale.t('admin.log.line.grant', { ...slots, role: named(row.details.to) });
    }

    if (row.kind === 'change')
    {
        return locale.t('admin.log.line.change', { ...slots, from: named(row.details.from), to: named(row.details.to) });
    }

    if (row.kind === 'note')
    {
        return locale.t('admin.log.line.note', slots);
    }

    return locale.t('admin.log.line.revoke', slots);
};

export const logParts = (row: LogRow, locale: LocaleApi) => handleParts(said(row, locale), { staff: row.staff, person: row.person ?? '' });
