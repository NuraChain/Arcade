import type { IconName } from '../../icons/registry.ts';
import type { Tab } from '../../lib/route-meta.ts';
import type { MessageKey } from '../../locales/en.ts';

export interface NavItem
{
    tab: Tab;
    lights: readonly Tab[];
    to: string;
    icon: IconName;
    labelKey: MessageKey;
}

export function lit(item: NavItem, tab: Tab | undefined): boolean
{
    return tab !== undefined && (item.tab === tab || item.lights.includes(tab));
}

const HOME: NavItem = { tab: 'home', lights: [], to: '/app', icon: 'home', labelKey: 'app.nav.home' };
const GAMES: NavItem = { tab: 'games', lights: [], to: '/app/games', icon: 'games', labelKey: 'app.nav.games' };
const FRIENDS: NavItem = { tab: 'friends', lights: [], to: '/app/friends', icon: 'people', labelKey: 'app.nav.friends' };
const CHATS: NavItem = { tab: 'chats', lights: [], to: '/app/chats', icon: 'chats', labelKey: 'app.nav.chats' };

export const NAV: NavItem[] = [
    HOME,
    { ...GAMES, lights: ['watch', 'leaderboard'] },
    { ...FRIENDS, lights: ['discover'] },
    CHATS,
    { tab: 'me', lights: ['settings'], to: '/app/me', icon: 'me', labelKey: 'app.nav.profile' }
];

export const RAIL: NavItem[] = [
    HOME,
    GAMES,
    { tab: 'watch', lights: [], to: '/app/watch', icon: 'watch', labelKey: 'app.nav.watch' },
    FRIENDS,
    CHATS,
    { tab: 'notifications', lights: [], to: '/app/notifications', icon: 'bell', labelKey: 'app.nav.notifications' },
    { tab: 'leaderboard', lights: [], to: '/app/leaderboard', icon: 'trophy', labelKey: 'app.nav.leaderboard' },
    { tab: 'discover', lights: [], to: '/app/discover', icon: 'discover', labelKey: 'app.nav.discover' },
    { tab: 'settings', lights: [], to: '/app/me/settings', icon: 'settings', labelKey: 'app.nav.settings' }
];

export const ACTIVE_ROW = '[&.is-active]:[background:linear-gradient(90deg,var(--accent-fill),color-mix(in_oklab,var(--accent-fill)_72%,var(--field)))] [&.is-active]:text-accent-ink [&.is-active]:[box-shadow:0_8px_24px_-12px_color-mix(in_oklab,var(--accent)_70%,transparent),inset_0_1px_0_rgb(255_255_255/0.12)]';
