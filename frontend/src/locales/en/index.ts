import type { Message } from '../format.ts';
import { app } from './app.ts';
import { landing } from './landing.ts';
import { play } from './play.ts';
import { social } from './social.ts';
import { me } from './me.ts';
import { wallet } from './wallet.ts';
import { helpers } from './helpers.ts';
import { helpersLudo } from './helpers-ludo.ts';
import { helpersHokm } from './helpers-hokm.ts';
import { helpersBackgammon } from './helpers-backgammon.ts';
import { helpersPoker } from './helpers-poker.ts';

export const en = { ...landing, ...app, ...play, ...social, ...wallet, ...me, ...helpers, ...helpersLudo, ...helpersHokm, ...helpersBackgammon, ...helpersPoker };

export type MessageKey = keyof typeof en;

export type Dictionary = Record<MessageKey, Message>;
