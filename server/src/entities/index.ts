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
export const entities: Function[] = [];
