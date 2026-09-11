import { registerCatalogue } from '../stores/locale.store.ts';
import { app as appEn } from './en/app.ts';
import { play as playEn } from './en/play.ts';
import { social as socialEn } from './en/social.ts';
import { wallet as walletEn } from './en/wallet.ts';
import { app as appFa } from './fa/app.ts';
import { play as playFa } from './fa/play.ts';
import { social as socialFa } from './fa/social.ts';
import { wallet as walletFa } from './fa/wallet.ts';

registerCatalogue({ en: { ...appEn, ...playEn, ...socialEn, ...walletEn }, fa: { ...appFa, ...playFa, ...socialFa, ...walletFa } });
