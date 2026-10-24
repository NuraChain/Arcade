import type { Dictionary } from '../en/index.ts';
import type { helpers as reference } from '../en/helpers.ts';

export const helpers: Pick<Dictionary, keyof typeof reference> = {
    'helpers.title': 'Ayudas de juego',
    'helpers.lead': 'Ayuda mientras juegas. Puedes desactivar cada una aquí o desde el menú de la mesa.',
    'helpers.moves': 'Mostrar lo que puedes jugar',
    'helpers.movesHint': 'Ilumina las fichas y cartas que puedes mover ahora mismo.',
    'helpers.outcome': 'Decir qué hace una jugada',
    'helpers.outcomeHint': 'Antes de confirmar, te dice si captura, gana la baza o saca una ficha.',
    'helpers.rules': 'Entrenador de reglas',
    'helpers.rulesHint': 'Un consejo breve sobre la regla que importa en este momento.',
    'helpers.tip': 'Consejo',
    'helpers.moves.show': 'Mostrar lo que puedo jugar',
    'helpers.moves.hide': 'Ocultar lo que puedo jugar',
    'helpers.outcome.show': 'Decir qué hace una jugada',
    'helpers.outcome.hide': 'Dejar de decir qué hace una jugada',
    'helpers.rules.show': 'Activar el entrenador de reglas',
    'helpers.rules.hide': 'Desactivar el entrenador de reglas'
};
