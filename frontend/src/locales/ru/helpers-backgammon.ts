import type { Dictionary } from '../en/index.ts';
import type { helpersBackgammon as reference } from '../en/helpers-backgammon.ts';

export const helpersBackgammon: Pick<Dictionary, keyof typeof reference> = {
    'helpers.backgammon.bar': 'Шашка на баре входит в игру первой. Пока она не вошла, больше ничего не ходит.',
    'helpers.backgammon.doubles': 'Дубль играется четыре раза: четыре хода по {die}.',
    'helpers.backgammon.both': 'Если можно сыграть оба кубика, играть нужно оба, поэтому ход, после которого второму кубику некуда идти, не предлагается.',
    'helpers.backgammon.higher': 'Здесь можно сыграть только один кубик, и если подходит любой, играется больший: {die}.',
    'helpers.backgammon.bear': 'Все твои шашки дома, можно начинать выбрасывать их с доски.',
    'helpers.backgammon.double': 'Перед броском можно удвоить: нажми на куб. Соперник либо играет дальше на {cube}, либо сдаёт эту партию.',
    'helpers.backgammon.take': 'Примешь — партия продолжится на {cube}. Сдашься — она закончится сейчас, на {now}.'
};
