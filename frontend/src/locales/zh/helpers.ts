import type { Dictionary } from '../en/index.ts';
import type { helpers as reference } from '../en/helpers.ts';

export const helpers: Pick<Dictionary, keyof typeof reference> = {
    'helpers.title': '游戏助手',
    'helpers.lead': '在你游戏时提供帮助。每一项都可以在这里或牌桌菜单中关闭。',
    'helpers.moves': '显示可走的步',
    'helpers.movesHint': '高亮你现在可以移动的棋子和可出的牌。',
    'helpers.outcome': '说明这一步的结果',
    'helpers.outcomeHint': '在你确定之前，说明这一步是否会吃子、赢下这一墩或移出棋子。',
    'helpers.rules': '规则教练',
    'helpers.rulesHint': '针对当前关键规则的一句简短提示。',
    'helpers.tip': '提示',
    'helpers.moves.show': '显示我可走的步',
    'helpers.moves.hide': '隐藏我可走的步',
    'helpers.outcome.show': '说明这一步的结果',
    'helpers.outcome.hide': '不再说明这一步的结果',
    'helpers.rules.show': '打开规则教练',
    'helpers.rules.hide': '关闭规则教练'
};
