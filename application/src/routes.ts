import type { PageRoute } from '@azerothjs/kit';

import PublicShell from './components/layout/public-shell.component.azeroth';
import { requireAnonymous, requireSession } from './lib/guards.ts';
import { defineMeta } from './lib/route-meta.ts';
import Landing from './pages/landing.page.azeroth';

export const routes: PageRoute[] = [
    {
        path: '/',
        component: PublicShell,
        render: 'static',
        children: [
            { path: '', component: Landing }
        ]
    },
    {
        path: '/sign-in',
        lazy: () => import('./pages/sign-in.page.azeroth'),
        render: 'client',
        guard: requireAnonymous
    },
    {
        path: '/app',
        lazy: () => import('./components/app/app-shell.component.azeroth'),
        render: 'client',
        guard: requireSession,
        children: [
            { path: '', lazy: () => import('./pages/app/home.page.azeroth'), meta: defineMeta({ title: 'app.nav.home', tab: 'home' }) },
            { path: 'games', lazy: () => import('./pages/app/games.page.azeroth'), meta: defineMeta({ title: 'app.nav.games', tab: 'games' }) },
            { path: 'games/:slug', lazy: () => import('./pages/app/game.page.azeroth'), meta: defineMeta({ tab: 'games', parent: '/app/games' }) },
            { path: 'games/:slug/create', lazy: () => import('./pages/app/create-game.page.azeroth'), meta: defineMeta({ title: 'create.title', tab: 'games', parent: '/app/games' }) },
            { path: 'play/:id', lazy: () => import('./pages/app/play.page.azeroth'), meta: defineMeta({ tab: 'games', parent: '/app/games', immersive: true }) },
            { path: 'friends', lazy: () => import('./pages/app/friends.page.azeroth'), meta: defineMeta({ title: 'app.nav.friends', tab: 'friends' }) },
            { path: 'people/:handle', lazy: () => import('./pages/app/person.page.azeroth'), meta: defineMeta({ tab: 'friends', parent: '/app/friends' }) },
            { path: 'chats', lazy: () => import('./pages/app/chats.page.azeroth'), meta: defineMeta({ title: 'app.nav.chats', tab: 'chats' }) },
            { path: 'chats/:id', lazy: () => import('./pages/app/chat.page.azeroth'), meta: defineMeta({ tab: 'chats', parent: '/app/chats', immersive: true }) },
            { path: 'groups/:id', lazy: () => import('./pages/app/group.page.azeroth'), meta: defineMeta({ tab: 'friends', parent: '/app/friends' }) },
            { path: 'discover', lazy: () => import('./pages/app/discover.page.azeroth'), meta: defineMeta({ title: 'app.nav.discover', tab: 'discover' }) },
            { path: 'search', lazy: () => import('./pages/app/search.page.azeroth'), meta: defineMeta({ title: 'app.nav.search', tab: 'search' }) },
            { path: 'notifications', lazy: () => import('./pages/app/notifications.page.azeroth'), meta: defineMeta({ title: 'app.nav.notifications', parent: '/app' }) },
            { path: 'me', lazy: () => import('./pages/app/me.page.azeroth'), meta: defineMeta({ title: 'app.nav.me', tab: 'me' }) },
            { path: 'me/settings', lazy: () => import('./pages/app/settings.page.azeroth'), meta: defineMeta({ title: 'app.nav.settings', tab: 'me', parent: '/app/me' }) },
            { path: 'me/devices', lazy: () => import('./pages/app/devices.page.azeroth'), meta: defineMeta({ title: 'devices.title', tab: 'me', parent: '/app/me/settings' }) }
        ]
    }
];
