import type { Dictionary } from '../en/index.ts';
import type { helpersChess as reference } from '../en/helpers-chess.ts';

export const helpersChess: Pick<Dictionary, keyof typeof reference> = {
    'helpers.chess.tip.first': 'Tu reloj empieza tras tu primera jugada. Hazla en menos de 30 segundos o la partida se anula y no cuenta para nadie.',
    'helpers.chess.tip.waitFirst': 'Si el otro jugador no hace su primera jugada en 30 segundos, la partida se anula y no cuenta para nadie.',
    'helpers.chess.tip.check': 'Estás en jaque: mueve el rey, interpón una pieza o captura la pieza que da jaque.',
    'helpers.chess.tip.checkKing': 'Solo tu rey puede salir de este jaque: muévelo a una casilla que nada ataque.',
    'helpers.chess.tip.promote': 'Un peón que llega a la última fila se convierte en dama, torre, alfil o caballo. Tú eliges.',
    'helpers.chess.tip.passant': 'El peón que acaba de avanzar dos casillas se puede capturar al paso, como si hubiera avanzado una. Solo en esta jugada.',
    'helpers.chess.tip.time': 'Te queda menos de un minuto. Si se te acaba el tiempo pierdes, salvo que al rival no le quede material para dar mate.',
    'helpers.chess.tip.castle': 'Puedes enrocar: mueve el rey dos casillas hacia una torre y la torre salta por encima de él.',
    'helpers.chess.tip.fifty': 'Cincuenta jugadas de cada bando sin capturas ni movimientos de peón terminan la partida en tablas, y esta partida está cerca.'
};
