import { Achievement } from './achievement.entity.ts';
import { GameRule } from './game-rule.entity.ts';
import { Game } from './game.entity.ts';
import { Session } from './session.entity.ts';
import { SiweNonce } from './siwe-nonce.entity.ts';
import { User } from './user.entity.ts';
import { Wallet } from './wallet.entity.ts';

export { Achievement, Game, GameRule, Session, SiweNonce, User, Wallet };

/**
 * Every entity, listed explicitly.
 *
 * Not a glob: TypeORM resolves glob patterns against `process.cwd()`, not against the file that
 * declares them, so a pattern that works under `npm run` yields nothing from anywhere else and
 * quietly resurrects the compiled remains of a deleted entity. Listing them also means a rename
 * fails `azeroth check` instead of failing at first query.
 *
 * The element type is TypeORM's own: a decorated class is a `Function` to it.
 */
export const entities: Function[] = [Game, GameRule, Achievement, User, Wallet, Session, SiweNonce];
