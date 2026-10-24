import type { Dictionary } from '../en/index.ts';
import type { app as reference } from '../en/app.ts';

export const app: Pick<Dictionary, keyof typeof reference> = {
    'app.title': 'Baziche',

    'app.nav.home': 'Accueil',
    'app.nav.games': 'Jeux',
    'app.nav.watch': 'Regarder',
    'app.nav.friends': 'Amis',
    'app.nav.chats': 'Discussions',
    'app.nav.profile': 'Profil',
    'app.nav.leaderboard': 'Classement',
    'app.nav.discover': 'Découvrir',
    'app.nav.search': 'Recherche',
    'app.nav.notifications': 'Notifications',
    'app.nav.settings': 'Réglages',
    'app.nav.back': 'Retour',
    'app.nav.primary': 'Navigation principale',
    'app.nav.signOut': 'Se déconnecter',
    'create.title': 'Créer une table',
    'app.nav.quickPlay': 'Partie rapide',
    'app.sidebar.collapse': 'Réduire le menu',
    'app.sidebar.expand': 'Déplier le menu',
    'app.search.placeholder': 'Cherche des jeux, des joueurs, des groupes…',

    'shell.panel': 'Activité et amis',
    'shell.activity': 'Activité',
    'shell.activity.empty': 'Les demandes d’ami, les invitations et les messages arrivent ici.',
    'shell.friends.empty': 'Aucun de tes amis n’est en ligne pour le moment.',

    'common.cancel': 'Annuler',
    'common.more': 'Plus',
    'common.retry': 'Réessayer',
    'common.loading': 'Chargement…',
    'common.close': 'Fermer',
    'common.clear': 'Effacer',
    'common.seeAll': 'Tout voir',
    'common.you': 'Toi',
    'common.listJoin': ', ',
    'common.online': 'En ligne',
    'common.away': 'Absent',
    'common.players': { one: '{count} joueur', many: '{count} joueurs', other: '{count} joueurs' },
    'common.unread': { one: '{count} non lu', many: '{count} non lus', other: '{count} non lus' },
    'common.requests': { one: '{count} demande d’ami', many: '{count} demandes d’ami', other: '{count} demandes d’ami' },
    'common.notices': { one: '{count} nouvelle notification', many: '{count} nouvelles notifications', other: '{count} nouvelles notifications' },
    'common.waitingTables': { one: '{count} table t’attend', many: '{count} tables t’attendent', other: '{count} tables t’attendent' },
    'common.optional': 'Facultatif',
    'common.actionFailed': 'Ça n’est pas passé. Réessaie.',
    'common.copyFailed': 'Ce navigateur refuse de le copier. Sélectionne-le et copie-le à la main.',
    'page.range': '{from}–{to} sur {total}',
    'page.previous': 'Page précédente',
    'page.next': 'Page suivante',
    'page.of': '{page} sur {pages}',
    'page.go': 'Page {page}',
    'page.more': 'Afficher {count} de plus',
    'page.shown': '{shown} affichés sur {total}',

    'toast.dismiss': 'Fermer',
    'toast.region': 'Notifications',
    'toast.more': '{count} de plus…',

    'app.refreshing': 'Actualisation…',

    'cue.chatBody': '{who} a envoyé un message',
    'cue.requestBody': '{who} veut devenir ton ami',
    'cue.open': 'Ouvrir',
    'cue.view': 'Voir',
    'cue.requests': 'Demandes',

    'overlay.handle': 'Glisse vers le bas pour fermer',

    'connection.offline': 'Tu es hors ligne. Les tables en direct continuent sans toi.',
    'connection.reconnecting': 'Connexion interrompue. Reconnexion…',
    'connection.unreached': 'Les mises à jour en direct ne passent pas. Cette page vérifie les changements toutes les quelques secondes.',
    'connection.restored': 'De nouveau en ligne.',

    'notice.close': 'Fermer cette annonce',
    'notice.gotIt': 'Compris',

    'state.errorTitle': 'Impossible de charger ça.',
    'state.errorLead': 'Si ça continue, vérifie ta connexion.'
};
