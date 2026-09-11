import type { Dictionary } from '../en/index.ts';
import { app } from './app.ts';
import { landing } from './landing.ts';
import { play } from './play.ts';
import { social } from './social.ts';
import { me } from './me.ts';
import { wallet } from './wallet.ts';

export const fa: Dictionary = { ...landing, ...app, ...play, ...social, ...wallet, ...me };
