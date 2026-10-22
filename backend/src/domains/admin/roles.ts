export const STAFF_ROLES = ['moderator', 'admin', 'owner'] as const;

export type StaffRole = (typeof STAFF_ROLES)[number];

export const GRANTED_ROLES = ['moderator', 'admin'] as const;

export type GrantedRole = (typeof GRANTED_ROLES)[number];

export const ACTION_KINDS = ['grant', 'change', 'revoke', 'note', 'suspend', 'lift', 'expire', 'clear', 'sign-out', 'report', 'game', 'void', 'close', 'minor', 'notice'] as const;

export type ActionKind = (typeof ACTION_KINDS)[number];

export const LOG_PAGE = 50;

export const SUSPEND_CATEGORIES = ['harassment', 'spam', 'cheating', 'inappropriate', 'other'] as const;

export type SuspendCategory = (typeof SUSPEND_CATEGORIES)[number];

export const SUSPEND_DAYS = [1, 7, 30] as const;

export type SuspendDays = (typeof SUSPEND_DAYS)[number];

export const CLEAR_PARTS = ['picture', 'name', 'bio'] as const;

export type ClearPart = (typeof CLEAR_PARTS)[number];

export const PEOPLE_LISTS = ['newest', 'suspended', 'minors', 'staff', 'reported'] as const;

export type PeopleList = (typeof PEOPLE_LISTS)[number];

export const PEOPLE_PAGE = 50;

export const REPORT_STATUSES = ['received', 'reviewed', 'actioned'] as const;

export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const REPORT_OUTCOMES = ['reviewed', 'actioned'] as const;

export type ReportOutcome = (typeof REPORT_OUTCOMES)[number];

export const REPORT_LISTS = ['received', 'reviewed', 'actioned', 'all'] as const;

export type ReportList = (typeof REPORT_LISTS)[number];

export const REPORTS_PAGE = 50;

export const STUCK_KINDS = ['no-engine', 'no-turn', 'no-autoplay', 'refused', 'threw'] as const;

export type StuckKind = (typeof STUCK_KINDS)[number];

export const MATCH_LISTS = ['all', 'stuck'] as const;

export type MatchList = (typeof MATCH_LISTS)[number];

export const PLAY_PAGE = 50;

export const NOTICE_HOURS = [1, 6, 24, 72, 168] as const;

export type NoticeHours = (typeof NOTICE_HOURS)[number];

export const NOTICE_MAX = 200;

export const ABILITIES = {
    overview: 'moderator',
    live: 'moderator',
    people: 'moderator',
    reports: 'moderator',
    play: 'admin',
    notice: 'admin',
    money: 'admin',
    staff: 'admin',
    log: 'admin',
    health: 'admin',
    wallet: 'owner'
} as const satisfies Record<string, StaffRole>;

export const LIVE_PAGE = 50;

export type Ability = keyof typeof ABILITIES;

const rankOf = (role: StaffRole | null) => (role === null ? -1 : STAFF_ROLES.indexOf(role));

export const may = (role: StaffRole | null, ability: Ability) => rankOf(role) >= rankOf(ABILITIES[ability]);

export const outranks = (actor: StaffRole | null, other: StaffRole | null) => actor !== null && rankOf(actor) > rankOf(other);
