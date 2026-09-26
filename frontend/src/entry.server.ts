import { createPageRenderer } from '@azerothjs/kit/ssr';

import App from './App.azeroth';
import { landing as faLanding } from './locales/fa/landing.ts';
import { routes } from './routes.ts';
import { registerCatalogue } from './stores/locale.store.ts';

registerCatalogue({ en: {}, fa: faLanding });

export { routes };
export const renderPage = createPageRenderer(App, routes);
