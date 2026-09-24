import type { IconName } from '../../icons/registry.ts';
import type { Tab } from '../../lib/route-meta.ts';
import type { MessageKey } from '../../locales/en.ts';

export interface NavItem
{
    tab: Tab;
    to: string;
    icon: IconName;
    labelKey: MessageKey;
    end: boolean;
}

const HOME: NavItem = { tab: 'home', to: '/app', icon: 'home', labelKey: 'app.nav.home', end: true };
const GAMES: NavItem = { tab: 'games', to: '/app/games', icon: 'games', labelKey: 'app.nav.games', end: false };
const FRIENDS: NavItem = { tab: 'friends', to: '/app/friends', icon: 'people', labelKey: 'app.nav.friends', end: false };
const CHATS: NavItem = { tab: 'chats', to: '/app/chats', icon: 'chats', labelKey: 'app.nav.chats', end: false };

export const NAV: NavItem[] = [
    HOME,
    GAMES,
    FRIENDS,
    CHATS,
    { tab: 'me', to: '/app/me', icon: 'me', labelKey: 'app.nav.profile', end: false }
];

export const RAIL: NavItem[] = [
    HOME,
    GAMES,
    FRIENDS,
    CHATS,
    { tab: 'notifications', to: '/app/notifications', icon: 'bell', labelKey: 'app.nav.notifications', end: false },
    { tab: 'leaderboard', to: '/app/leaderboard', icon: 'trophy', labelKey: 'app.nav.leaderboard', end: false },
    { tab: 'discover', to: '/app/discover', icon: 'discover', labelKey: 'app.nav.discover', end: false },
    { tab: 'me', to: '/app/me/settings', icon: 'settings', labelKey: 'app.nav.settings', end: false }
];

export const ACTIVE_ROW = '[&.is-active]:[background:linear-gradient(90deg,var(--accent-fill),color-mix(in_oklab,var(--accent-fill)_72%,var(--field)))] [&.is-active]:text-accent-ink [&.is-active]:[box-shadow:0_8px_24px_-12px_color-mix(in_oklab,var(--accent)_70%,transparent),inset_0_1px_0_rgb(255_255_255/0.12)]';
