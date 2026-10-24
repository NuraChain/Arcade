import type { Dictionary } from '../en/index.ts';
import type { helpersChess as reference } from '../en/helpers-chess.ts';

export const helpersChess: Pick<Dictionary, keyof typeof reference> = {
    'helpers.chess.tip.first': '你走出第一步后才开始计时。请在 30 秒内走出，否则这局取消，不计入任何人的成绩。',
    'helpers.chess.tip.waitFirst': '如果对方 30 秒内没有走出第一步，这局取消，不计入任何人的成绩。',
    'helpers.chess.tip.check': '你被将军了：移动你的王，用棋子挡住，或者吃掉将军的那枚棋子。',
    'helpers.chess.tip.checkKing': '只有王能解除这次将军：把它走到不受攻击的格子。',
    'helpers.chess.tip.promote': '兵走到底线后可以升变为后、车、象或马，由你选择。',
    'helpers.chess.tip.passant': '刚刚走了两格的兵可以被吃过路兵，就当它只走了一格。只限这一步。',
    'helpers.chess.tip.time': '剩余不到一分钟。时间用完你就输了，除非对方剩下的子力不足以将杀。',
    'helpers.chess.tip.castle': '你可以王车易位：王朝一侧的车走两格，车越过王落到它的另一边。',
    'helpers.chess.tip.fifty': '双方各走五十步都没有吃子也没有走兵，这局判和，这局已经接近了。'
};
