import type { Dictionary } from '../en/index.ts';
import { app } from './app.ts';
import { landing } from './landing.ts';

export const fa: Dictionary = { ...landing, ...app };
