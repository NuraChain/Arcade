import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { prerender } from '@azerothjs/kit/prerender';

const application = resolve(import.meta.dirname, '..', 'application');
const entry = await import(pathToFileURL(resolve(application, 'dist-server', 'entry.server.js')).href);

const written = await prerender({
    routes: entry.routes,
    clientDir: resolve(application, 'dist'),
    renderer: entry.renderPage,
    locales: ['en', 'fa']
});

console.log(`  prerender   ${ written.join(', ') }`);

const BESIDE = '(min-width: 64rem), (orientation: landscape) and (max-height: 540px) and (min-aspect-ratio: 4/3)';

const UPRIGHT = '(max-width: 63.99rem) and (not ((orientation: landscape) and (max-height: 540px) and (min-aspect-ratio: 4/3)))';

for (const [locale, wide] of [['en', 'poster-wide-ltr'], ['fa', 'poster-wide-rtl']])
{
    const file = resolve(application, 'dist', `index.${ locale }.html`);
    const page = readFileSync(file, 'utf8');
    const preload = [
        `<link rel="preload" as="image" href="/world/poster-portrait.webp" type="image/webp" media="${ UPRIGHT }" fetchpriority="high"/>`,
        `<link rel="preload" as="image" href="/world/${ wide }.webp" type="image/webp" media="${ BESIDE }" fetchpriority="high"/>`
    ].join('');

    if (!page.includes('/world/poster-portrait.webp" type="image/webp" media'))
    {
        writeFileSync(file, page.replace('</head>', `${ preload }</head>`));
    }
}
