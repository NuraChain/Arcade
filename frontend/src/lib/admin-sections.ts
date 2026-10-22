import { may, type Ability, type StaffRole } from '../../../backend/src/domains/admin/roles.ts';

export const ADMIN_SECTIONS = ['people', 'reports', 'play', 'money', 'staff', 'log'] as const satisfies readonly Ability[];

export type AdminSection = (typeof ADMIN_SECTIONS)[number];

export const sectionsFor = (role: StaffRole | null) => ADMIN_SECTIONS.filter((section) => may(role, section));
