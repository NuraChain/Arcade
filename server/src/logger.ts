import { createLogger, teeSink, terminalSink, type Logger } from '@azerothjs/logger';
import { fileSink } from '@azerothjs/logger/node';

import type { ServerConfig } from './env.ts';

/**
 * Everything that must never reach a sink.
 *
 * A bare name matches that key at any depth, which is what makes `authorization` cover
 * `{ headers }` without naming the path. The crypto entries matter more than the usual
 * suspects: this product is end-to-end encrypted, and a wrapped key or a recovery phrase in a
 * log file would defeat the whole design far more quietly than a leaked password would.
 */
const REDACT = [
    'authorization',
    'cookie',
    'set-cookie',
    'password',
    'secret',
    'token',
    'ticket',
    'signature',
    'nonce',
    'ciphertext',
    'wrapped',
    'phrase',
    'recovery',
    'databaseUrl',
    'DATABASE_URL'
];

/**
 * One logger for the process.
 *
 * Explorer writes only to a file, which silences the terminal and makes `npm run dev` look
 * dead. A tee keeps the terminal honest during development and still leaves an ndjson trail on
 * disk for anything after it.
 */
export function createServerLogger(config: ServerConfig): Logger
{
    return createLogger({
        level: config.env === 'production' ? 'info' : 'debug',
        sink: teeSink(terminalSink(), fileSink('logs/')),
        redact: REDACT,
        fields: { service: 'nura-games-server', env: config.env }
    });
}
