import type { Dictionary } from '../en/index.ts';
import type { helpersChess as reference } from '../en/helpers-chess.ts';

export const helpersChess: Pick<Dictionary, keyof typeof reference> = {
    'helpers.chess.tip.first': 'Seu relógio começa depois do seu primeiro lance. Faça ele em até 30 segundos, ou a partida é cancelada e não vale para ninguém.',
    'helpers.chess.tip.waitFirst': 'Se o outro jogador não fizer o primeiro lance em até 30 segundos, a partida é cancelada e não vale para ninguém.',
    'helpers.chess.tip.check': 'Você está em xeque: mova o rei, coloque uma peça no caminho ou capture a peça que dá o xeque.',
    'helpers.chess.tip.checkKing': 'Só o seu rei sai deste xeque: leve-o para uma casa que nada ataca.',
    'helpers.chess.tip.promote': 'Um peão que chega à última fileira vira dama, torre, bispo ou cavalo. Você escolhe.',
    'helpers.chess.tip.passant': 'O peão que acabou de andar duas casas pode ser capturado en passant, como se tivesse andado uma. Só neste lance.',
    'helpers.chess.tip.time': 'Menos de um minuto. Se o seu tempo acabar você perde, a não ser que o outro lado não tenha material para dar mate.',
    'helpers.chess.tip.castle': 'Você pode rocar: mova o rei duas casas em direção a uma torre, e a torre pula por cima dele.',
    'helpers.chess.tip.fifty': 'Cinquenta lances de cada lado sem captura e sem mover peão terminam a partida empatada, e esta partida está perto disso.'
};
