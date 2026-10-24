import type { Dictionary } from '../en/index.ts';
import type { helpersChess as reference } from '../en/helpers-chess.ts';

export const helpersChess: Pick<Dictionary, keyof typeof reference> = {
    'helpers.chess.tip.first': 'Ta pendule démarre après ton premier coup. Joue-le dans les 30 secondes, sinon la partie est annulée et ne compte pour personne.',
    'helpers.chess.tip.waitFirst': 'Si l’autre joueur ne joue pas son premier coup dans les 30 secondes, la partie est annulée et ne compte pour personne.',
    'helpers.chess.tip.check': 'Tu es en échec : déplace ton roi, interpose une pièce ou prends la pièce qui donne échec.',
    'helpers.chess.tip.checkKing': 'Seul ton roi peut parer cet échec : place-le sur une case que rien n’attaque.',
    'helpers.chess.tip.promote': 'Un pion qui atteint la dernière rangée devient une dame, une tour, un fou ou un cavalier. À toi de choisir.',
    'helpers.chess.tip.passant': 'Le pion qui vient d’avancer de deux cases peut être pris en passant, comme s’il n’avait avancé que d’une. Seulement à ce coup-ci.',
    'helpers.chess.tip.time': 'Moins d’une minute restante. Si ta pendule tombe à zéro, tu perds, sauf si l’adversaire n’a plus assez de matériel pour mater.',
    'helpers.chess.tip.castle': 'Tu peux roquer : ton roi se déplace de deux cases vers une tour, et la tour saute par-dessus.',
    'helpers.chess.tip.fifty': 'Cinquante coups chacun sans prise ni mouvement de pion mènent à la nulle, et cette partie s’en approche.'
};
