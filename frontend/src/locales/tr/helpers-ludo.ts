import type { Dictionary } from '../en/index.ts';
import type { helpersLudo as reference } from '../en/helpers-ludo.ts';

export const helpersLudo: Pick<Dictionary, keyof typeof reference> = {
    'helpers.ludo.tip.yard': 'Yolda hiç piyonun yok: piyonu evden yalnızca altı çıkarır.',
    'helpers.ludo.tip.six': 'Altı geldi: bu hamleden sonra bir daha atarsın.',
    'helpers.ludo.tip.threeSixes': 'Üst üste üç altı sırayı bitirir, üçüncüsü oynanmaz.',
    'helpers.ludo.tip.star': 'Yıldızlar güvenli: üstüne konmak kimseyi eve göndermez. Bunu yalnızca kendi başlangıcına çıkan piyon yapar.',
    'helpers.ludo.tip.blocked': 'Aynı renkten iki piyon bir barikat kurar: başka renk ne üstüne konabilir ne üstünden geçebilir, üçüncü piyon da katılamaz.',
    'helpers.ludo.tip.blockedTeams': 'Aynı taraftan iki piyon, ortaklar dahil, bir barikat kurar: rakip ne üstüne konabilir ne üstünden geçebilir, üçüncü piyon da katılamaz.',
    'helpers.ludo.tip.partner': 'Ortaklar birbirini asla eve göndermez: ortağının üstüne konmak barikat kurar.',
    'helpers.ludo.tip.helping': 'Dört piyonun da hedefte, artık her atışın ortağının piyonlarını oynatır. Altı yine bir atış daha getirir.',
    'helpers.ludo.tip.start': 'Başlangıç karesinde aynı anda kendi renginden yalnızca bir piyon durabilir: yenisini çıkarmadan önce onu ilerlet.',
    'helpers.ludo.tip.exact': 'Hedefe tam sayıyla girilir; bu atış için fazla yakın olan piyon yerinde kalır.'
};
