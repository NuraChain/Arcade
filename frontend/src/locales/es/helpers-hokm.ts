import type { Dictionary } from '../en/index.ts';
import type { helpersHokm as reference } from '../en/helpers-hokm.ts';

export const helpersHokm: Pick<Dictionary, keyof typeof reference> = {
    'helpers.hokm.lead': 'Abre la baza.',
    'helpers.hokm.lead.trump': 'Abre con triunfo: todos tienen que jugar triunfo mientras les quede.',
    'helpers.hokm.ahead': 'Por ahora gana la baza.',
    'helpers.hokm.ahead.trump': 'Un triunfo, y por ahora gana la baza.',
    'helpers.hokm.wins': 'Gana la baza.',
    'helpers.hokm.wins.trump': 'Un triunfo, y gana la baza.',
    'helpers.hokm.loses': 'No puede ganar esta baza.',
    'helpers.hokm.loses.trump': 'Un triunfo, pero ya hay uno más alto en la mesa.',
    'helpers.hokm.tip.name': 'Elige el palo del que más cartas tengas. El triunfo gana a cualquier otro palo durante el resto de la mano.',
    'helpers.hokm.tip.name.clubs': 'Tienes más tréboles que de cualquier otro palo. El hakem suele elegir el palo del que más tiene.',
    'helpers.hokm.tip.name.diamonds': 'Tienes más diamantes que de cualquier otro palo. El hakem suele elegir el palo del que más tiene.',
    'helpers.hokm.tip.name.hearts': 'Tienes más corazones que de cualquier otro palo. El hakem suele elegir el palo del que más tiene.',
    'helpers.hokm.tip.name.spades': 'Tienes más picas que de cualquier otro palo. El hakem suele elegir el palo del que más tiene.',
    'helpers.hokm.tip.wait': 'El hakem elige el triunfo con sus cinco primeras cartas. El resto del reparto espera a que lo haga.',
    'helpers.hokm.tip.wait.draw': 'El hakem elige el triunfo con sus cinco primeras cartas. Luego cada uno descarta boca abajo y roba del mazo hasta tener trece.',
    'helpers.hokm.tip.away': 'Descarta las cartas que menos vayas a echar de menos: las bajas, y ninguna del palo de triunfo si puedes evitarlo. Tócalas para levantarlas y luego toca el mazo.',
    'helpers.hokm.tip.keep': 'Vale la pena quedársela: un triunfo, o un diez o más. Toca la carta para quedártela y la siguiente irá boca abajo.',
    'helpers.hokm.tip.pass': 'Una carta baja que no es triunfo. Toca el mazo para pasarla boca abajo, y tendrás que quedarte la siguiente, sea cual sea.',
    'helpers.hokm.tip.lead': 'Sales tú, así que cualquier carta puede abrir la baza. Los demás tienen que seguir su palo mientras lo tengan.',
    'helpers.hokm.tip.trump': 'No tienes del palo que se ha jugado, así que vale cualquier carta, y un triunfo gana la baza salvo que otro más alto lo supere.',
    'helpers.hokm.tip.discard': 'No tienes del palo que se ha jugado ni triunfo, así que ninguna de tus cartas puede ganar esta baza. Tira una que no vayas a echar de menos.'
};
