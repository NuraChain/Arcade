import type { Dictionary } from '../en/index.ts';
import type { helpersHokm as reference } from '../en/helpers-hokm.ts';

export const helpersHokm: Pick<Dictionary, keyof typeof reference> = {
    'helpers.hokm.lead': 'Eli açar.',
    'helpers.hokm.lead.trump': 'Kozla açar: elinde koz olan herkes koz oynamak zorunda.',
    'helpers.hokm.ahead': 'Şimdilik eli alıyor.',
    'helpers.hokm.ahead.trump': 'Koz, şimdilik eli alıyor.',
    'helpers.hokm.wins': 'Eli alır.',
    'helpers.hokm.wins.trump': 'Koz, eli alır.',
    'helpers.hokm.loses': 'Bu eli alamaz.',
    'helpers.hokm.loses.trump': 'Koz ama yere daha büyük bir koz atılmış.',
    'helpers.hokm.tip.name': 'En çok tuttuğun rengi koz yap. Koz, elin sonuna kadar diğer bütün renkleri yener.',
    'helpers.hokm.tip.name.clubs': 'En çok sinek tutuyorsun. Hâkim genelde en çok tuttuğu rengi koz yapar.',
    'helpers.hokm.tip.name.diamonds': 'En çok karo tutuyorsun. Hâkim genelde en çok tuttuğu rengi koz yapar.',
    'helpers.hokm.tip.name.hearts': 'En çok kupa tutuyorsun. Hâkim genelde en çok tuttuğu rengi koz yapar.',
    'helpers.hokm.tip.name.spades': 'En çok maça tutuyorsun. Hâkim genelde en çok tuttuğu rengi koz yapar.',
    'helpers.hokm.tip.wait': 'Hâkim kozu ilk beş kartına bakarak seçer. Dağıtımın gerisi o seçene kadar bekler.',
    'helpers.hokm.tip.wait.draw': 'Hâkim kozu ilk beş kartına bakarak seçer. Sonra ikiniz de kart kapatıp destedekilerden çekersiniz, ta ki ikinizin de elinde on üç kart olana dek.',
    'helpers.hokm.tip.away': 'En az arayacağın kartları kapat: küçükleri, mümkünse hiç koz olmadan. Kaldırmak için kartlara dokun, sonra desteye dokun.',
    'helpers.hokm.tip.keep': 'Tutmaya değer: koz ya da on ve üstü. Tutmak için karta dokun, sıradaki kart kapalı gider.',
    'helpers.hokm.tip.pass': 'Koz dışından küçük bir kart. Kapalı geçmek için desteye dokun; sıradakini ne olursa olsun tutmak zorundasın.',
    'helpers.hokm.tip.lead': 'Eli sen açıyorsun, istediğin kartla başlayabilirsin. Diğerleri ellerinde varsa o rengi oynamak zorunda.',
    'helpers.hokm.tip.trump': 'Açılan renkten sende yok, istediğin kartı atabilirsin; daha büyüğü gelmezse koz eli alır.',
    'helpers.hokm.tip.discard': 'Açılan renkten de koz da sende yok, hiçbir kartın bu eli alamaz. Aramayacağın bir kartı at.'
};
