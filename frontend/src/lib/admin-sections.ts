import { may, type Ability, type StaffRole } from '../../../backend/src/domains/admin/roles.ts';

export const ADMIN_SECTIONS = ['overview', 'live', 'people', 'reports', 'play', 'notice', 'money', 'staff', 'log'] as const satisfies readonly Ability[];

export type AdminSection = (typeof ADMIN_SECTIONS)[number];

export const SECTION_GROUPS = [
    { id: 'now', sections: ['overview', 'live'] },
    { id: 'moderation', sections: ['people', 'reports'] },
    { id: 'platform', sections: ['play', 'notice', 'money'] },
    { id: 'team', sections: ['staff', 'log'] }
] as const satisfies readonly { id: string; sections: readonly AdminSection[] }[];

export type SectionGroup = (typeof SECTION_GROUPS)[number]['id'];

export const TABS_MOST = 5;

const FIRST_TABS: readonly AdminSection[] = ['overview', 'people', 'reports', 'play'];

export const sectionsFor = (role: StaffRole | null) => ADMIN_SECTIONS.filter((section) => may(role, section));

export const groupsFor = (role: StaffRole | null) => SECTION_GROUPS
    .map((group) => ({ id: group.id, sections: group.sections.filter((section) => may(role, section)) }))
    .filter((group) => group.sections.length > 0);

export const tabsFor = (role: StaffRole | null) =>
{
    const opened = sectionsFor(role);

    if (opened.length <= TABS_MOST)
    {
        return { tabs: opened, more: [] };
    }

    const ranked = [...opened.filter((section) => FIRST_TABS.includes(section)), ...opened.filter((section) => !FIRST_TABS.includes(section))];
    const kept = ranked.slice(0, TABS_MOST - 1);

    return { tabs: opened.filter((section) => kept.includes(section)), more: opened.filter((section) => !kept.includes(section)) };
};
