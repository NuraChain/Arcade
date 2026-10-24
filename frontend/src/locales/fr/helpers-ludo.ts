import type { Dictionary } from '../en/index.ts';
import type { helpersLudo as reference } from '../en/helpers-ludo.ts';

export const helpersLudo: Pick<Dictionary, keyof typeof reference> = {
    'helpers.ludo.tip.yard': 'Aucun pion n’est sur le parcours : seul un six en fait sortir un de l’écurie.',
    'helpers.ludo.tip.six': 'Un six : après ce coup, tu relances.',
    'helpers.ludo.tip.threeSixes': 'Trois six d’affilée terminent le tour, et le troisième n’est pas joué.',
    'helpers.ludo.tip.star': 'Les étoiles sont des cases sûres : s’y poser ne renvoie personne à la maison. Seul un pion qui sort sur sa propre case de départ le fait.',
    'helpers.ludo.tip.blocked': 'Deux pions d’une même couleur forment un barrage : aucune autre couleur ne peut s’y poser ni le dépasser, et aucun troisième pion ne peut le rejoindre.',
    'helpers.ludo.tip.blockedTeams': 'Deux pions d’un même camp forment un barrage, partenaires compris : aucun adversaire ne peut s’y poser ni le dépasser, et aucun troisième pion ne peut le rejoindre.',
    'helpers.ludo.tip.partner': 'Des partenaires ne se renvoient jamais à la maison : te poser sur ton partenaire forme un barrage.',
    'helpers.ludo.tip.helping': 'Tes quatre pions sont arrivés : chacun de tes lancers fait désormais avancer les pions de ton partenaire. Un six fait toujours rejouer.',
    'helpers.ludo.tip.start': 'Une case de départ n’accueille qu’un pion de sa couleur à la fois : avance celui-ci avant d’en sortir un autre.',
    'helpers.ludo.tip.exact': 'Pour arriver, il faut le compte exact : un pion trop proche pour ce lancer reste où il est.'
};
