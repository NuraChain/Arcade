import type { Dictionary } from '../en/index.ts';
import type { helpersBackgammon as reference } from '../en/helpers-backgammon.ts';

export const helpersBackgammon: Pick<Dictionary, keyof typeof reference> = {
    'helpers.backgammon.bar': '被打到中间栏的棋子要先回到棋盘上。它进场之前，其他棋子都不能走。',
    'helpers.backgammon.doubles': '掷出对子要走四次：每次走 {die} 点，共四步。',
    'helpers.backgammon.both': '两个骰子能用时都必须用，所以会让另一个骰子无路可走的走法不会出现。',
    'helpers.backgammon.higher': '这里只能用一个骰子，两个都能用时必须用大的那个：{die} 点。',
    'helpers.backgammon.bear': '你的棋子都已回到内盘，可以开始移出棋子了。',
    'helpers.backgammon.double': '掷骰之前你可以加倍：点一下倍数骰。对方要么以 {cube} 倍继续，要么认输这一局。',
    'helpers.backgammon.take': '接受，这一局就以 {cube} 倍继续。认输，这一局现在以 {now} 倍结束。'
};
