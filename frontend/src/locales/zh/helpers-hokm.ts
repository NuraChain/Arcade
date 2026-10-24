import type { Dictionary } from '../en/index.ts';
import type { helpersHokm as reference } from '../en/helpers-hokm.ts';

export const helpersHokm: Pick<Dictionary, keyof typeof reference> = {
    'helpers.hokm.lead': '首出这一墩。',
    'helpers.hokm.lead.trump': '首出将牌：手里有将牌的人都必须跟将牌。',
    'helpers.hokm.ahead': '目前赢着这一墩。',
    'helpers.hokm.ahead.trump': '将牌，目前赢着这一墩。',
    'helpers.hokm.wins': '赢下这一墩。',
    'helpers.hokm.wins.trump': '将牌，赢下这一墩。',
    'helpers.hokm.loses': '赢不了这一墩。',
    'helpers.hokm.loses.trump': '将牌，但已经有更大的将牌出了。',
    'helpers.hokm.tip.name': '选你手里最多的花色。这一局剩下的时间里，将牌大过其他所有花色。',
    'helpers.hokm.tip.name.clubs': '你手里梅花最多。庄家通常会选自己最多的花色。',
    'helpers.hokm.tip.name.diamonds': '你手里方块最多。庄家通常会选自己最多的花色。',
    'helpers.hokm.tip.name.hearts': '你手里红桃最多。庄家通常会选自己最多的花色。',
    'helpers.hokm.tip.name.spades': '你手里黑桃最多。庄家通常会选自己最多的花色。',
    'helpers.hokm.tip.wait': '庄家根据前五张牌选定将牌。选定之前，剩下的牌暂不发。',
    'helpers.hokm.tip.wait.draw': '庄家根据前五张牌选定将牌。然后你们俩轮流扣牌并从牌堆摸牌，直到各有十三张。',
    'helpers.hokm.tip.away': '扣掉你最不心疼的牌：小牌，尽量别扣将牌花色。点牌把它抬起，再点牌堆。',
    'helpers.hokm.tip.keep': '值得留下：将牌，或者 10 以上的牌。点这张牌留下它，下一张会扣下。',
    'helpers.hokm.tip.pass': '非将牌的小牌。点牌堆把它扣下，下一张不管是什么你都必须留下。',
    'helpers.hokm.tip.lead': '轮到你首出，任何牌都可以开始这一墩。其他人有这个花色就必须跟。',
    'helpers.hokm.tip.trump': '你没有首出的花色，所以任何牌都能出，将牌会赢下这一墩，除非有更大的将牌。',
    'helpers.hokm.tip.discard': '你没有首出的花色也没有将牌，手里没有牌能赢这一墩。扔一张你不心疼的吧。'
};
