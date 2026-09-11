import type { Message } from '../format.ts';
import { app } from './app.ts';
import { landing } from './landing.ts';
import { play } from './play.ts';

export const en = { ...landing, ...app, ...play };

export type MessageKey = keyof typeof en;

export type Dictionary = Record<MessageKey, Message>;
