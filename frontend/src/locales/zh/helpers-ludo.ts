import type { Dictionary } from '../en/index.ts';
import type { helpersLudo as reference } from '../en/helpers-ludo.ts';

export const helpersLudo: Pick<Dictionary, keyof typeof reference> = {
    'helpers.ludo.tip.yard': '跑道上还没有你的棋子：只有掷出六点才能从基地出一枚。',
    'helpers.ludo.tip.six': '六点：走完这一步你再掷一次。',
    'helpers.ludo.tip.threeSixes': '连续三次六点会结束这一回合，第三次不走。',
    'helpers.ludo.tip.star': '星格是安全格：停在上面不会把任何人打回基地。只有棋子出到自己的起点时才会。',
    'helpers.ludo.tip.blocked': '同色两枚棋子组成路障：其他颜色不能停在上面或越过它，第三枚棋子也不能加入。',
    'helpers.ludo.tip.blockedTeams': '同一方的两枚棋子组成路障，队友也算：对手不能停在上面或越过它，第三枚棋子也不能加入。',
    'helpers.ludo.tip.partner': '队友之间不会互相打回基地：停在队友的棋子上会组成路障。',
    'helpers.ludo.tip.helping': '你的四枚棋子都到家了，现在你每次掷骰都走队友的棋子。掷出六点照样再掷一次。',
    'helpers.ludo.tip.start': '起点格一次只能放一枚本色棋子：先把它走开，再出下一枚。',
    'helpers.ludo.tip.exact': '进家要点数刚好，离得太近、这次点数过大的棋子只能原地不动。'
};
