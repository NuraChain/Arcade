import type { Dictionary } from '../en/index.ts';
import type { app as reference } from '../en/app.ts';

export const app: Pick<Dictionary, keyof typeof reference> = {
    'app.title': 'Baziche',

    'app.nav.home': '首页',
    'app.nav.games': '游戏',
    'app.nav.watch': '观战',
    'app.nav.friends': '好友',
    'app.nav.chats': '聊天',
    'app.nav.profile': '个人资料',
    'app.nav.leaderboard': '排行榜',
    'app.nav.discover': '发现',
    'app.nav.search': '搜索',
    'app.nav.notifications': '通知',
    'app.nav.settings': '设置',
    'app.nav.back': '返回',
    'app.nav.primary': '主导航',
    'app.nav.signOut': '退出登录',
    'create.title': '创建牌桌',
    'app.nav.quickPlay': '快速开局',
    'app.sidebar.collapse': '收起菜单',
    'app.sidebar.expand': '展开菜单',
    'app.search.placeholder': '搜索游戏、玩家、群组…',

    'shell.panel': '动态与好友',
    'shell.activity': '动态',
    'shell.activity.empty': '好友请求、邀请和消息都会出现在这里。',
    'shell.friends.empty': '你的好友现在都不在线。',

    'common.cancel': '取消',
    'common.more': '更多',
    'common.retry': '重试',
    'common.loading': '加载中…',
    'common.close': '关闭',
    'common.clear': '清除',
    'common.seeAll': '查看全部',
    'common.you': '你',
    'common.listJoin': '、',
    'common.online': '在线',
    'common.away': '离开',
    'common.players': { other: '{count} 名玩家' },
    'common.unread': { other: '{count} 条未读' },
    'common.requests': { other: '{count} 个好友请求' },
    'common.notices': { other: '{count} 条新通知' },
    'common.waitingTables': { other: '{count} 张牌桌在等你' },
    'common.optional': '可选',
    'common.actionFailed': '操作没有成功，请重试。',
    'common.copyFailed': '此浏览器无法复制，请手动选中后复制。',
    'page.range': '第 {from}–{to} 条，共 {total} 条',
    'page.previous': '上一页',
    'page.next': '下一页',
    'page.of': '第 {page} 页，共 {pages} 页',
    'page.go': '第 {page} 页',
    'page.more': '再显示 {count} 条',
    'page.shown': '已显示 {shown} / {total}',

    'toast.dismiss': '关闭',
    'toast.region': '通知',
    'toast.more': '还有 {count} 条…',

    'app.refreshing': '刷新中…',

    'cue.chatBody': '{who} 发来一条消息',
    'cue.requestBody': '{who} 想加你为好友',
    'cue.open': '打开',
    'cue.view': '查看',
    'cue.requests': '请求',

    'overlay.handle': '向下拖动以关闭',

    'connection.offline': '你已离线。进行中的牌局会在没有你的情况下继续。',
    'connection.reconnecting': '连接中断，正在重新连接…',
    'connection.unreached': '实时更新无法送达。此页面会每隔几秒检查一次变化。',
    'connection.restored': '已恢复在线。',

    'notice.close': '关闭此公告',
    'notice.gotIt': '知道了',

    'state.errorTitle': '无法加载此内容。',
    'state.errorLead': '如果一直出现这个问题，请检查你的网络连接。'
};
