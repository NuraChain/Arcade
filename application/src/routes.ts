import type { PageRoute } from '@azerothjs/kit';

import Landing from './pages/landing.page.azeroth';

export const routes: PageRoute[] = [
    { path: '/', component: Landing, render: 'static' }
];
