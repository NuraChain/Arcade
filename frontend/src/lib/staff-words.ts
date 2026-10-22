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

export const CATEGORY_WORDS: Readonly<Record<string, MessageKey>> = {
    harassment: 'report.category.harassment',
    spam: 'report.category.spam',
    cheating: 'report.category.cheating',
    inappropriate: 'report.category.inappropriate',
    other: 'report.category.other'
};

export const TERM_WORDS: Readonly<Record<string, MessageKey>> = {
    1: 'admin.suspend.term.1',
    7: 'admin.suspend.term.7',
    30: 'admin.suspend.term.30'
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

    if (row.kind === 'suspend')
    {
        return locale.t('admin.log.line.suspend', {
            ...slots,
            term: locale.t(TERM_WORDS[row.details.days ?? ''] ?? 'admin.suspend.term.good'),
            category: locale.t(CATEGORY_WORDS[row.details.category ?? ''] ?? 'report.category.other')
        });
    }

    if (row.kind === 'lift')
    {
        return locale.t('admin.log.line.lift', slots);
    }

    if (row.kind === 'expire')
    {
        return locale.t('admin.log.line.expire', slots);
    }

    return locale.t('admin.log.line.revoke', slots);
};

export const logParts = (row: LogRow, locale: LocaleApi) => handleParts(said(row, locale), { staff: row.staff ?? '', person: row.person ?? '' });
