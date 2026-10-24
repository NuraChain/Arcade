import type { Dictionary } from '../en/index.ts';
import type { app as reference } from '../en/app.ts';

export const app: Pick<Dictionary, keyof typeof reference> = {
    'app.title': 'Baziche',

    'app.nav.home': 'Inicio',
    'app.nav.games': 'Juegos',
    'app.nav.watch': 'Ver',
    'app.nav.friends': 'Amigos',
    'app.nav.chats': 'Chats',
    'app.nav.profile': 'Perfil',
    'app.nav.leaderboard': 'Clasificación',
    'app.nav.discover': 'Descubrir',
    'app.nav.search': 'Buscar',
    'app.nav.notifications': 'Notificaciones',
    'app.nav.settings': 'Ajustes',
    'app.nav.back': 'Atrás',
    'app.nav.primary': 'Navegación principal',
    'app.nav.signOut': 'Cerrar sesión',
    'create.title': 'Crear una mesa',
    'app.nav.quickPlay': 'Partida rápida',
    'app.sidebar.collapse': 'Contraer el menú',
    'app.sidebar.expand': 'Expandir el menú',
    'app.search.placeholder': 'Busca juegos, personas, grupos…',

    'shell.panel': 'Actividad y amigos',
    'shell.activity': 'Actividad',
    'shell.activity.empty': 'Aquí llegan las solicitudes de amistad, las invitaciones y los mensajes.',
    'shell.friends.empty': 'Ninguno de tus amigos está conectado ahora mismo.',

    'common.cancel': 'Cancelar',
    'common.more': 'Más',
    'common.retry': 'Reintentar',
    'common.loading': 'Cargando…',
    'common.close': 'Cerrar',
    'common.clear': 'Borrar',
    'common.seeAll': 'Ver todo',
    'common.you': 'Tú',
    'common.listJoin': ', ',
    'common.online': 'Conectado',
    'common.away': 'Ausente',
    'common.players': { one: '{count} jugador', many: '{count} jugadores', other: '{count} jugadores' },
    'common.unread': { one: '{count} sin leer', many: '{count} sin leer', other: '{count} sin leer' },
    'common.requests': { one: '{count} solicitud de amistad', many: '{count} solicitudes de amistad', other: '{count} solicitudes de amistad' },
    'common.notices': { one: '{count} notificación nueva', many: '{count} notificaciones nuevas', other: '{count} notificaciones nuevas' },
    'common.waitingTables': { one: '{count} mesa te está esperando', many: '{count} mesas te están esperando', other: '{count} mesas te están esperando' },
    'common.optional': 'Opcional',
    'common.actionFailed': 'No se ha podido hacer. Inténtalo de nuevo.',
    'common.copyFailed': 'Este navegador no ha querido copiarlo. Selecciónalo y cópialo a mano.',
    'page.range': '{from}–{to} de {total}',
    'page.previous': 'Página anterior',
    'page.next': 'Página siguiente',
    'page.of': '{page} de {pages}',
    'page.go': 'Página {page}',
    'page.more': 'Mostrar {count} más',
    'page.shown': 'Mostrando {shown} de {total}',

    'toast.dismiss': 'Descartar',
    'toast.region': 'Notificaciones',
    'toast.more': '{count} más…',

    'app.refreshing': 'Actualizando…',

    'cue.chatBody': '{who} te ha enviado un mensaje',
    'cue.requestBody': '{who} quiere ser tu amigo',
    'cue.open': 'Abrir',
    'cue.view': 'Ver',
    'cue.requests': 'Solicitudes',

    'overlay.handle': 'Desliza hacia abajo para cerrar',

    'connection.offline': 'Estás sin conexión. Las mesas en vivo siguen jugando sin ti.',
    'connection.reconnecting': 'Conexión interrumpida. Reconectando…',
    'connection.unreached': 'Las actualizaciones en vivo no llegan. Esta página busca cambios cada pocos segundos.',
    'connection.restored': 'Conectado de nuevo.',

    'notice.close': 'Cerrar este anuncio',
    'notice.gotIt': 'Entendido',

    'state.errorTitle': 'No se ha podido cargar.',
    'state.errorLead': 'Si sigue pasando, revisa tu conexión.'
};
