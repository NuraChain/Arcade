export const REFUSALS = {
    'not-your-turn': 'forbidden',
    'not-playing': 'forbidden',
    'not-the-hakem': 'forbidden',
    'already-rolled': 'conflict',
    'must-roll-first': 'conflict',
    'illegal-move': 'conflict',
    'game-over': 'conflict',
    'trump-already-set': 'conflict',
    'tricks-not-started': 'conflict',
    'not-discarding': 'conflict',
    'discard-count': 'conflict',
    'not-drawing': 'conflict',
    'must-follow-suit': 'conflict',
    'no-such-card': 'conflict',
    'cannot-double': 'conflict',
    'no-double': 'conflict',
    'double-pending': 'conflict',
    'cannot-check': 'conflict',
    'nothing-to-call': 'conflict',
    'cannot-raise': 'conflict',
    'raise-too-small': 'conflict',
    'raise-too-large': 'conflict',
    'unplayable': 'conflict'
} as const satisfies Record<string, 'forbidden' | 'conflict'>;

export type RefusalWord = keyof typeof REFUSALS;

export const isRefusal = (value: string): value is RefusalWord => Object.hasOwn(REFUSALS, value);
