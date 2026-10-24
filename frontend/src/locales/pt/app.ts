import type { Dictionary } from '../en/index.ts';
import type { app as reference } from '../en/app.ts';

export const app: Pick<Dictionary, keyof typeof reference> = {
    'app.title': 'Baziche',

    'app.nav.home': 'Início',
    'app.nav.games': 'Jogos',
    'app.nav.watch': 'Assistir',
    'app.nav.friends': 'Amigos',
    'app.nav.chats': 'Conversas',
    'app.nav.profile': 'Perfil',
    'app.nav.leaderboard': 'Ranking',
    'app.nav.discover': 'Descobrir',
    'app.nav.search': 'Buscar',
    'app.nav.notifications': 'Notificações',
    'app.nav.settings': 'Configurações',
    'app.nav.back': 'Voltar',
    'app.nav.primary': 'Navegação principal',
    'app.nav.signOut': 'Sair',
    'create.title': 'Criar uma mesa',
    'app.nav.quickPlay': 'Partida rápida',
    'app.sidebar.collapse': 'Recolher o menu',
    'app.sidebar.expand': 'Expandir o menu',
    'app.search.placeholder': 'Busque jogos, pessoas, grupos…',

    'shell.panel': 'Atividade e amigos',
    'shell.activity': 'Atividade',
    'shell.activity.empty': 'Pedidos de amizade, convites e mensagens aparecem aqui.',
    'shell.friends.empty': 'Nenhum dos seus amigos está online agora.',

    'common.cancel': 'Cancelar',
    'common.more': 'Mais',
    'common.retry': 'Tentar de novo',
    'common.loading': 'Carregando…',
    'common.close': 'Fechar',
    'common.clear': 'Limpar',
    'common.seeAll': 'Ver tudo',
    'common.you': 'Você',
    'common.listJoin': ', ',
    'common.online': 'Online',
    'common.away': 'Ausente',
    'common.players': { one: '{count} jogador', many: '{count} jogadores', other: '{count} jogadores' },
    'common.unread': { one: '{count} não lida', many: '{count} não lidas', other: '{count} não lidas' },
    'common.requests': { one: '{count} pedido de amizade', many: '{count} pedidos de amizade', other: '{count} pedidos de amizade' },
    'common.notices': { one: '{count} notificação nova', many: '{count} notificações novas', other: '{count} notificações novas' },
    'common.waitingTables': { one: '{count} mesa esperando por você', many: '{count} mesas esperando por você', other: '{count} mesas esperando por você' },
    'common.optional': 'Opcional',
    'common.actionFailed': 'Não deu certo. Tente de novo.',
    'common.copyFailed': 'Este navegador não deixou copiar. Selecione e copie na mão.',
    'page.range': '{from}–{to} de {total}',
    'page.previous': 'Página anterior',
    'page.next': 'Próxima página',
    'page.of': '{page} de {pages}',
    'page.go': 'Página {page}',
    'page.more': 'Mostrar mais {count}',
    'page.shown': 'Mostrando {shown} de {total}',

    'toast.dismiss': 'Dispensar',
    'toast.region': 'Notificações',
    'toast.more': 'Mais {count}…',

    'app.refreshing': 'Atualizando…',

    'cue.chatBody': '{who} mandou uma mensagem',
    'cue.requestBody': '{who} quer ser seu amigo',
    'cue.open': 'Abrir',
    'cue.view': 'Ver',
    'cue.requests': 'Pedidos',

    'overlay.handle': 'Arraste para baixo para fechar',

    'connection.offline': 'Você está offline. As mesas ao vivo continuam sem você.',
    'connection.reconnecting': 'Conexão interrompida. Reconectando…',
    'connection.unreached': 'As atualizações ao vivo não estão chegando. Esta página procura mudanças a cada poucos segundos.',
    'connection.restored': 'Online de novo.',

    'notice.close': 'Fechar este aviso',
    'notice.gotIt': 'Entendi',

    'state.errorTitle': 'Não deu para carregar isto.',
    'state.errorLead': 'Se isso continuar acontecendo, verifique sua conexão.'
};
