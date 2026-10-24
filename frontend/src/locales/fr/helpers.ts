import type { Dictionary } from '../en/index.ts';
import type { helpers as reference } from '../en/helpers.ts';

export const helpers: Pick<Dictionary, keyof typeof reference> = {
    'helpers.title': 'Aides de jeu',
    'helpers.lead': 'De l’aide pendant que tu joues. Chacune peut être désactivée ici ou depuis le menu de la table.',
    'helpers.moves': 'Montrer ce que tu peux jouer',
    'helpers.movesHint': 'Met en lumière les pièces et les cartes que tu peux jouer tout de suite.',
    'helpers.outcome': 'Dire ce que fait un coup',
    'helpers.outcomeHint': 'Avant de valider, indique si le coup capture, remporte la levée ou sort un pion.',
    'helpers.rules': 'Coach des règles',
    'helpers.rulesHint': 'Un petit conseil sur la règle qui compte à ce moment-là.',
    'helpers.tip': 'Conseil',
    'helpers.moves.show': 'Montrer ce que je peux jouer',
    'helpers.moves.hide': 'Masquer ce que je peux jouer',
    'helpers.outcome.show': 'Dire ce que fait un coup',
    'helpers.outcome.hide': 'Ne plus dire ce que fait un coup',
    'helpers.rules.show': 'Activer le coach des règles',
    'helpers.rules.hide': 'Désactiver le coach des règles'
};
