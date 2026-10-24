import type { Dictionary } from '../en/index.ts';
import type { app as reference } from '../en/app.ts';

export const app: Pick<Dictionary, keyof typeof reference> = {
    'app.title': 'Baziche',

    'app.nav.home': 'Главная',
    'app.nav.games': 'Игры',
    'app.nav.watch': 'Смотреть',
    'app.nav.friends': 'Друзья',
    'app.nav.chats': 'Чаты',
    'app.nav.profile': 'Профиль',
    'app.nav.leaderboard': 'Рейтинг',
    'app.nav.discover': 'Обзор',
    'app.nav.search': 'Поиск',
    'app.nav.notifications': 'Уведомления',
    'app.nav.settings': 'Настройки',
    'app.nav.back': 'Назад',
    'app.nav.primary': 'Главное меню',
    'app.nav.signOut': 'Выйти',
    'create.title': 'Создать стол',
    'app.nav.quickPlay': 'Быстрая игра',
    'app.sidebar.collapse': 'Свернуть меню',
    'app.sidebar.expand': 'Развернуть меню',
    'app.search.placeholder': 'Игры, люди, группы…',

    'shell.panel': 'Активность и друзья',
    'shell.activity': 'Активность',
    'shell.activity.empty': 'Здесь появятся заявки в друзья, приглашения и сообщения.',
    'shell.friends.empty': 'Сейчас никого из друзей нет в сети.',

    'common.cancel': 'Отмена',
    'common.more': 'Ещё',
    'common.retry': 'Попробовать снова',
    'common.loading': 'Загрузка…',
    'common.close': 'Закрыть',
    'common.clear': 'Очистить',
    'common.seeAll': 'Все',
    'common.you': 'Ты',
    'common.listJoin': ', ',
    'common.online': 'В сети',
    'common.away': 'Не у экрана',
    'common.players': { one: '{count} игрок', few: '{count} игрока', many: '{count} игроков', other: '{count} игрока' },
    'common.unread': { one: '{count} непрочитанное', few: '{count} непрочитанных', many: '{count} непрочитанных', other: '{count} непрочитанного' },
    'common.requests': { one: '{count} заявка в друзья', few: '{count} заявки в друзья', many: '{count} заявок в друзья', other: '{count} заявки в друзья' },
    'common.notices': { one: '{count} новое уведомление', few: '{count} новых уведомления', many: '{count} новых уведомлений', other: '{count} нового уведомления' },
    'common.waitingTables': { one: '{count} стол ждёт тебя', few: '{count} стола ждут тебя', many: '{count} столов ждут тебя', other: '{count} стола ждут тебя' },
    'common.optional': 'Необязательно',
    'common.actionFailed': 'Не получилось. Попробуй ещё раз.',
    'common.copyFailed': 'Браузер не дал скопировать. Выдели текст и скопируй вручную.',
    'page.range': '{from}–{to} из {total}',
    'page.previous': 'Предыдущая страница',
    'page.next': 'Следующая страница',
    'page.of': '{page} из {pages}',
    'page.go': 'Страница {page}',
    'page.more': 'Показать ещё: {count}',
    'page.shown': 'Показано {shown} из {total}',

    'toast.dismiss': 'Скрыть',
    'toast.region': 'Уведомления',
    'toast.more': 'Ещё: {count}…',

    'app.refreshing': 'Обновляем…',

    'cue.chatBody': 'Новое сообщение от {who}',
    'cue.requestBody': '{who} хочет добавить тебя в друзья',
    'cue.open': 'Открыть',
    'cue.view': 'Посмотреть',
    'cue.requests': 'Заявки',

    'overlay.handle': 'Потяни вниз, чтобы закрыть',

    'connection.offline': 'Ты не в сети. Живые столы продолжают играть без тебя.',
    'connection.reconnecting': 'Связь прервалась. Переподключаемся…',
    'connection.unreached': 'Живые обновления не доходят. Страница проверяет изменения каждые несколько секунд.',
    'connection.restored': 'Снова в сети.',

    'notice.close': 'Закрыть объявление',
    'notice.gotIt': 'Понятно',

    'state.errorTitle': 'Не удалось загрузить.',
    'state.errorLead': 'Если это повторяется, проверь подключение.'
};
