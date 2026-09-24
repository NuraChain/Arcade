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
