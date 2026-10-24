import type { Dictionary } from '../en/index.ts';
import type { helpersBackgammon as reference } from '../en/helpers-backgammon.ts';

export const helpersBackgammon: Pick<Dictionary, keyof typeof reference> = {
    'helpers.backgammon.bar': 'Un pion sur la barre doit rentrer en premier. Rien d’autre ne bouge tant qu’il n’est pas rentré.',
    'helpers.backgammon.doubles': 'Un double se joue quatre fois : quatre déplacements de {die}.',
    'helpers.backgammon.both': 'Les deux dés doivent être joués quand c’est possible : un coup qui laisserait l’autre dé sans destination n’est pas proposé.',
    'helpers.backgammon.higher': 'Un seul dé peut être joué ici, et si les deux conviennent, il faut jouer le plus fort : le {die}.',
    'helpers.backgammon.bear': 'Tous tes pions sont dans ton jan intérieur : tu peux commencer à les sortir.',
    'helpers.backgammon.double': 'Avant de lancer, tu peux doubler : touche le videau. L’adversaire continue alors à {cube} ou abandonne cette partie.',
    'helpers.backgammon.take': 'Accepte, et la partie continue à {cube}. Abandonne, et elle s’arrête maintenant, à {now}.'
};
