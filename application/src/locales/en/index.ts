import type { Message } from '../format.ts';
import { app } from './app.ts';
import { landing } from './landing.ts';

export const en = { ...landing, ...app };

export type MessageKey = keyof typeof en;

export type Dictionary = Record<MessageKey, Message>;
