import { createPageRenderer } from '@azerothjs/kit/ssr';

import App from './App.azeroth';
import { landing as arLanding } from './locales/ar/landing.ts';
import { landing as esLanding } from './locales/es/landing.ts';
import { landing as faLanding } from './locales/fa/landing.ts';
import { landing as frLanding } from './locales/fr/landing.ts';
import { landing as hiLanding } from './locales/hi/landing.ts';
import { landing as ptLanding } from './locales/pt/landing.ts';
import { landing as ruLanding } from './locales/ru/landing.ts';
import { landing as trLanding } from './locales/tr/landing.ts';
import { landing as zhLanding } from './locales/zh/landing.ts';
import { routes } from './routes.ts';
import { registerCatalogue } from './stores/locale.store.ts';

registerCatalogue({ fa: faLanding, ar: arLanding, es: esLanding, pt: ptLanding, hi: hiLanding, zh: zhLanding, ru: ruLanding, fr: frLanding, tr: trLanding });

export { routes };
export const renderPage = createPageRenderer(App, routes);
