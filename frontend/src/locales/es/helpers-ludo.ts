import type { Dictionary } from '../en/index.ts';
import type { helpersLudo as reference } from '../en/helpers-ludo.ts';

export const helpersLudo: Pick<Dictionary, keyof typeof reference> = {
    'helpers.ludo.tip.yard': 'No tienes ninguna ficha en el recorrido: solo un seis saca una de la base.',
    'helpers.ludo.tip.six': 'Un seis: después de esta jugada vuelves a tirar.',
    'helpers.ludo.tip.threeSixes': 'Tres seises seguidos terminan el turno, y el tercero no se juega.',
    'helpers.ludo.tip.star': 'Las estrellas son seguras: caer en una no manda a nadie a casa. Solo lo hace una ficha que sale a su propia casilla de salida.',
    'helpers.ludo.tip.blocked': 'Dos fichas del mismo color forman un bloqueo: ningún otro color puede caer en él ni pasarlo, y no se puede sumar una tercera ficha.',
    'helpers.ludo.tip.blockedTeams': 'Dos fichas del mismo bando forman un bloqueo, también las del compañero: ningún rival puede caer en él ni pasarlo, y no se puede sumar una tercera ficha.',
    'helpers.ludo.tip.partner': 'Los compañeros nunca se mandan a casa: caer sobre tu compañero forma un bloqueo.',
    'helpers.ludo.tip.helping': 'Tus cuatro fichas ya están en la meta, así que cada tirada tuya mueve ahora las fichas de tu compañero. Un seis sigue dando otra tirada.',
    'helpers.ludo.tip.start': 'Una casilla de salida admite una sola ficha de su color a la vez: avanza esa antes de sacar otra.',
    'helpers.ludo.tip.exact': 'Para llegar a la meta hace falta el número exacto, así que una ficha demasiado cerca para esta tirada se queda donde está.'
};
