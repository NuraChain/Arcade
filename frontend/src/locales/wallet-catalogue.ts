import { registerCatalogue } from '../stores/locale.store.ts';
import { wallet as walletEn } from './en/wallet.ts';
import { wallet as walletFa } from './fa/wallet.ts';

registerCatalogue({ en: walletEn, fa: walletFa });
