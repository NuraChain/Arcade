import type { Dictionary } from '../en/index.ts';
import { app } from './app.ts';
import { landing } from './landing.ts';
import { play } from './play.ts';
import { social } from './social.ts';

export const fa: Dictionary = { ...landing, ...app, ...play, ...social };
