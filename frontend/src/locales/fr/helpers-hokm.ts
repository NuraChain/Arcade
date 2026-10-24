import type { Dictionary } from '../en/index.ts';
import type { helpersHokm as reference } from '../en/helpers-hokm.ts';

export const helpersHokm: Pick<Dictionary, keyof typeof reference> = {
    'helpers.hokm.lead': 'Ouvre la levée.',
    'helpers.hokm.lead.trump': 'Ouvre à l’atout : chacun doit jouer atout tant qu’il en a.',
    'helpers.hokm.ahead': 'Remporte la levée pour l’instant.',
    'helpers.hokm.ahead.trump': 'Un atout, qui remporte la levée pour l’instant.',
    'helpers.hokm.wins': 'Remporte la levée.',
    'helpers.hokm.wins.trump': 'Un atout, qui remporte la levée.',
    'helpers.hokm.loses': 'Ne peut pas remporter cette levée.',
    'helpers.hokm.loses.trump': 'Un atout, mais un atout plus fort est déjà posé.',
    'helpers.hokm.tip.name': 'Annonce la couleur dont tu as le plus de cartes. L’atout bat toutes les autres couleurs jusqu’à la fin de la donne.',
    'helpers.hokm.tip.name.clubs': 'Tu as plus de trèfles que de toute autre couleur. Le hakem annonce d’habitude sa couleur la plus longue.',
    'helpers.hokm.tip.name.diamonds': 'Tu as plus de carreaux que de toute autre couleur. Le hakem annonce d’habitude sa couleur la plus longue.',
    'helpers.hokm.tip.name.hearts': 'Tu as plus de cœurs que de toute autre couleur. Le hakem annonce d’habitude sa couleur la plus longue.',
    'helpers.hokm.tip.name.spades': 'Tu as plus de piques que de toute autre couleur. Le hakem annonce d’habitude sa couleur la plus longue.',
    'helpers.hokm.tip.wait': 'Le hakem annonce l’atout d’après ses cinq premières cartes. Le reste de la donne attend qu’il l’ait fait.',
    'helpers.hokm.tip.wait.draw': 'Le hakem annonce l’atout d’après ses cinq premières cartes. Ensuite, vous posez tous les deux des cartes face cachée et piochez jusqu’à en avoir treize chacun.',
    'helpers.hokm.tip.away': 'Pose les cartes qui te manqueront le moins : des petites, et aucune de la couleur d’atout si tu peux l’éviter. Touche-les pour les lever, puis touche la pioche.',
    'helpers.hokm.tip.keep': 'À garder : un atout, ou un dix ou mieux. Touche la carte pour la garder, et la suivante part face cachée.',
    'helpers.hokm.tip.pass': 'Une petite carte hors atout. Touche la pioche pour la passer face cachée, et tu devras garder la suivante, quelle qu’elle soit.',
    'helpers.hokm.tip.lead': 'C’est toi qui ouvres : n’importe quelle carte peut commencer la levée. Les autres doivent fournir dans sa couleur tant qu’ils en ont.',
    'helpers.hokm.tip.trump': 'Tu n’as pas la couleur demandée : toute carte est permise, et un atout remporte la levée sauf si un atout plus fort le bat.',
    'helpers.hokm.tip.discard': 'Tu n’as ni la couleur demandée ni atout : aucune de tes cartes ne peut remporter cette levée. Défausse-toi d’une carte qui ne te manquera pas.'
};
