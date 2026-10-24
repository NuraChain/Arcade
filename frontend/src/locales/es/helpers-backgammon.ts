import type { Dictionary } from '../en/index.ts';
import type { helpersBackgammon as reference } from '../en/helpers-backgammon.ts';

export const helpersBackgammon: Pick<Dictionary, keyof typeof reference> = {
    'helpers.backgammon.bar': 'Una ficha en la barra entra primero. No se mueve nada más hasta que haya entrado.',
    'helpers.backgammon.doubles': 'Un doble se juega cuatro veces: cuatro movimientos de {die}.',
    'helpers.backgammon.both': 'Hay que jugar los dos dados siempre que se pueda, así que no se ofrece una jugada que deje el otro dado sin movimiento posible.',
    'helpers.backgammon.higher': 'Aquí solo se puede jugar un dado y, si caben los dos, tiene que ser el mayor: el {die}.',
    'helpers.backgammon.bear': 'Todas tus fichas están en casa, así que ya puedes empezar a sacarlas.',
    'helpers.backgammon.double': 'Antes de tirar puedes doblar: toca el cubo. El rival sigue jugando a {cube} o abandona esta partida.',
    'helpers.backgammon.take': 'Si aceptas, la partida sigue a {cube}. Si abandonas, termina ahora, a {now}.'
};
