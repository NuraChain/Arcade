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

export const NAV: NavItem[] = [
    { tab: 'home', to: '/app', icon: 'home', labelKey: 'app.nav.home', end: true },
    { tab: 'games', to: '/app/games', icon: 'games', labelKey: 'app.nav.games', end: false },
    { tab: 'friends', to: '/app/friends', icon: 'people', labelKey: 'app.nav.friends', end: false },
    { tab: 'chats', to: '/app/chats', icon: 'chats', labelKey: 'app.nav.chats', end: false },
    { tab: 'me', to: '/app/me', icon: 'me', labelKey: 'app.nav.me', end: false }
];

export const SECONDARY: NavItem[] = [
    { tab: 'discover', to: '/app/discover', icon: 'discover', labelKey: 'app.nav.discover', end: false },
    { tab: 'search', to: '/app/search', icon: 'search', labelKey: 'app.nav.search', end: false }
];
