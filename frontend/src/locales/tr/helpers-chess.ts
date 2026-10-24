import type { Dictionary } from '../en/index.ts';
import type { helpersChess as reference } from '../en/helpers-chess.ts';

export const helpersChess: Pick<Dictionary, keyof typeof reference> = {
    'helpers.chess.tip.first': 'Saatin ilk hamlenden sonra başlar. 30 saniye içinde oyna, yoksa oyun iptal olur ve kimseye sayılmaz.',
    'helpers.chess.tip.waitFirst': 'Rakip 30 saniye içinde ilk hamlesini yapmazsa oyun iptal olur ve kimseye sayılmaz.',
    'helpers.chess.tip.check': 'Şah çekildi: şahını kaçır, araya bir taş koy ya da şah çeken taşı al.',
    'helpers.chess.tip.checkKing': 'Bu şahtan yalnızca şahın kurtulabilir: onu hiçbir taşın tehdit etmediği bir kareye götür.',
    'helpers.chess.tip.promote': 'Son sıraya ulaşan piyon vezir, kale, fil ya da ata dönüşür. Hangisi olacağını sen seçersin.',
    'helpers.chess.tip.passant': 'Az önce iki kare ilerleyen piyon, tek kare ilerlemiş gibi geçerken alınabilir. Yalnızca bu hamlede.',
    'helpers.chess.tip.time': 'Bir dakikadan az kaldı. Süren biterse kaybedersin; rakibin mat edecek kadar taşı kalmadıysa başka.',
    'helpers.chess.tip.castle': 'Rok yapabilirsin: şahını bir kaleye doğru iki kare götür, kale de onun üstünden atlar.',
    'helpers.chess.tip.fifty': 'Taş alınmadan ve piyon oynamadan geçen ellişer hamle oyunu berabere bitirir; bu oyun buna yaklaştı.'
};
