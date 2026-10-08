import type { PageRoute } from '@azerothjs/kit';

import PublicShell from './components/layout/public-shell.component.azeroth';
import { chunk } from './lib/chunks.ts';
import { requireAdmin, requireAnonymous, requireSession } from './lib/guards.ts';
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
        lazy: chunk(() => import('./pages/sign-in.page.azeroth')),
        render: 'client',
        guard: requireAnonymous
    },
    {
        path: '/admin',
        lazy: chunk(() => import('./pages/admin.page.azeroth')),
        render: 'client',
        guard: requireAdmin
    },
    {
        path: '/app',
        lazy: chunk(() => import('./components/app/app-shell.component.azeroth')),
        render: 'client',
        guard: requireSession,
        children: [
            { path: '', lazy: chunk(() => import('./pages/app/home.page.azeroth')), meta: defineMeta({ title: 'app.nav.home', tab: 'home' }) },
            { path: 'games', lazy: chunk(() => import('./pages/app/games.page.azeroth')), meta: defineMeta({ title: 'app.nav.games', tab: 'games' }) },
            { path: 'watch', lazy: chunk(() => import('./pages/app/watch.page.azeroth')), meta: defineMeta({ title: 'watch.page.title', tab: 'watch', parent: '/app/games' }) },
            { path: 'games/:slug', lazy: chunk(() => import('./pages/app/game.page.azeroth')), meta: defineMeta({ tab: 'games', parent: '/app/games' }) },
            { path: 'games/:slug/create', lazy: chunk(() => import('./pages/app/create-game.page.azeroth')), meta: defineMeta({ title: 'create.title', tab: 'games', parent: '/app/games/:slug' }) },
            { path: 'play/:id', lazy: chunk(() => import('./pages/app/play.page.azeroth')), meta: defineMeta({ tab: 'games', parent: '/app/games', immersive: true }) },
            { path: 'friends', lazy: chunk(() => import('./pages/app/friends.page.azeroth')), meta: defineMeta({ title: 'app.nav.friends', tab: 'friends' }) },
            { path: 'people/:handle', lazy: chunk(() => import('./pages/app/person.page.azeroth')), meta: defineMeta({ tab: 'friends', parent: '/app/friends' }) },
            { path: 'chats', lazy: chunk(() => import('./pages/app/chats.page.azeroth')), meta: defineMeta({ title: 'app.nav.chats', tab: 'chats', messenger: true }) },
            { path: 'chats/:id', lazy: chunk(() => import('./pages/app/chat.page.azeroth')), meta: defineMeta({ tab: 'chats', parent: '/app/chats', immersive: true, messenger: true }) },
            { path: 'groups/:id', lazy: chunk(() => import('./pages/app/group.page.azeroth')), meta: defineMeta({ tab: 'friends', parent: '/app/friends' }) },
            { path: 'leaderboard', lazy: chunk(() => import('./pages/app/leaderboard.page.azeroth')), meta: defineMeta({ title: 'app.nav.leaderboard', tab: 'leaderboard' }) },
            { path: 'discover', lazy: chunk(() => import('./pages/app/discover.page.azeroth')), meta: defineMeta({ title: 'app.nav.discover', tab: 'discover' }) },
            { path: 'search', lazy: chunk(() => import('./pages/app/search.page.azeroth')), meta: defineMeta({ title: 'app.nav.search', tab: 'search' }) },
            { path: 'notifications', lazy: chunk(() => import('./pages/app/notifications.page.azeroth')), meta: defineMeta({ title: 'app.nav.notifications', tab: 'notifications', parent: '/app' }) },
            { path: 'me', lazy: chunk(() => import('./pages/app/me.page.azeroth')), meta: defineMeta({ title: 'app.nav.profile', tab: 'me' }) },
            { path: 'me/nfts', lazy: chunk(() => import('./pages/app/nfts.page.azeroth')), meta: defineMeta({ title: 'nfts.title', tab: 'me', parent: '/app/me' }) },
            { path: 'me/settings', lazy: chunk(() => import('./pages/app/settings.page.azeroth')), meta: defineMeta({ title: 'app.nav.settings', tab: 'settings', parent: '/app/me' }) },
            { path: 'me/devices', lazy: chunk(() => import('./pages/app/devices.page.azeroth')), meta: defineMeta({ title: 'devices.title', tab: 'settings', parent: '/app/me/settings' }) }
        ]
    }
];
