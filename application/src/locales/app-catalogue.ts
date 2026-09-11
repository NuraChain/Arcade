import { registerCatalogue } from '../stores/locale.store.ts';
import { app as appEn } from './en/app.ts';
import { play as playEn } from './en/play.ts';
import { social as socialEn } from './en/social.ts';
import { app as appFa } from './fa/app.ts';
import { play as playFa } from './fa/play.ts';
import { social as socialFa } from './fa/social.ts';

registerCatalogue({ en: { ...appEn, ...playEn, ...socialEn }, fa: { ...appFa, ...playFa, ...socialFa } });
