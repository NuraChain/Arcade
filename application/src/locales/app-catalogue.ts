import { registerCatalogue } from '../stores/locale.store.ts';
import { app as appEn } from './en/app.ts';
import { play as playEn } from './en/play.ts';
import { app as appFa } from './fa/app.ts';
import { play as playFa } from './fa/play.ts';

registerCatalogue({ en: { ...appEn, ...playEn }, fa: { ...appFa, ...playFa } });
