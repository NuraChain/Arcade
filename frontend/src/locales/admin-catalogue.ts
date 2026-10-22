import { registerCatalogue } from '../stores/locale.store.ts';
import { admin as adminEn } from './en/admin.ts';
import { admin as adminFa } from './fa/admin.ts';

registerCatalogue({ en: adminEn, fa: adminFa });
