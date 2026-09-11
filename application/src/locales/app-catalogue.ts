import { registerCatalogue } from '../stores/locale.store.ts';
import { app as en } from './en/app.ts';
import { app as fa } from './fa/app.ts';

registerCatalogue({ en, fa });
