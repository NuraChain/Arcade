import type { Dictionary } from '../en/index.ts';
import type { app as reference } from '../en/app.ts';

export const app: Pick<Dictionary, keyof typeof reference> = {
    'app.title': 'Baziche',

    'app.nav.home': 'Ana sayfa',
    'app.nav.games': 'Oyunlar',
    'app.nav.watch': 'İzle',
    'app.nav.friends': 'Arkadaşlar',
    'app.nav.chats': 'Sohbetler',
    'app.nav.profile': 'Profil',
    'app.nav.leaderboard': 'Sıralama',
    'app.nav.discover': 'Keşfet',
    'app.nav.search': 'Ara',
    'app.nav.notifications': 'Bildirimler',
    'app.nav.settings': 'Ayarlar',
    'app.nav.back': 'Geri',
    'app.nav.primary': 'Ana menü',
    'app.nav.signOut': 'Çıkış yap',
    'create.title': 'Masa aç',
    'app.nav.quickPlay': 'Hızlı oyun',
    'app.sidebar.collapse': 'Menüyü daralt',
    'app.sidebar.expand': 'Menüyü genişlet',
    'app.search.placeholder': 'Oyun, kişi, grup ara…',

    'shell.panel': 'Etkinlik ve arkadaşlar',
    'shell.activity': 'Etkinlik',
    'shell.activity.empty': 'Arkadaşlık istekleri, davetler ve mesajlar buraya düşer.',
    'shell.friends.empty': 'Şu an çevrimiçi arkadaşın yok.',

    'common.cancel': 'Vazgeç',
    'common.more': 'Daha fazla',
    'common.retry': 'Tekrar dene',
    'common.loading': 'Yükleniyor…',
    'common.close': 'Kapat',
    'common.clear': 'Temizle',
    'common.seeAll': 'Tümünü gör',
    'common.you': 'Sen',
    'common.listJoin': ', ',
    'common.online': 'Çevrimiçi',
    'common.away': 'Uzakta',
    'common.players': { one: '{count} oyuncu', other: '{count} oyuncu' },
    'common.unread': { one: '{count} okunmamış', other: '{count} okunmamış' },
    'common.requests': { one: '{count} arkadaşlık isteği', other: '{count} arkadaşlık isteği' },
    'common.notices': { one: '{count} yeni bildirim', other: '{count} yeni bildirim' },
    'common.waitingTables': { one: 'Seni bekleyen {count} masa', other: 'Seni bekleyen {count} masa' },
    'common.optional': 'İsteğe bağlı',
    'common.actionFailed': 'Olmadı. Tekrar dene.',
    'common.copyFailed': 'Bu tarayıcı kopyalamadı. Seçip elle kopyala.',
    'page.range': '{from}–{to} / {total}',
    'page.previous': 'Önceki sayfa',
    'page.next': 'Sonraki sayfa',
    'page.of': '{page} / {pages}',
    'page.go': 'Sayfa {page}',
    'page.more': '{count} tane daha göster',
    'page.shown': 'Gösterilen: {shown} / {total}',

    'toast.dismiss': 'Kapat',
    'toast.region': 'Bildirimler',
    'toast.more': '{count} tane daha…',

    'app.refreshing': 'Yenileniyor…',

    'cue.chatBody': 'Mesaj gönderen: {who}',
    'cue.requestBody': 'Seninle arkadaş olmak isteyen: {who}',
    'cue.open': 'Aç',
    'cue.view': 'Gör',
    'cue.requests': 'İstekler',

    'overlay.handle': 'Kapatmak için aşağı çek',

    'connection.offline': 'Çevrimdışısın. Canlı masalar sensiz oynamaya devam ediyor.',
    'connection.reconnecting': 'Bağlantı koptu. Yeniden bağlanılıyor…',
    'connection.unreached': 'Canlı güncellemeler ulaşmıyor. Bu sayfa birkaç saniyede bir değişiklikleri kontrol ediyor.',
    'connection.restored': 'Yeniden çevrimiçisin.',

    'notice.close': 'Bu duyuruyu kapat',
    'notice.gotIt': 'Tamam',

    'state.errorTitle': 'Bu yüklenemedi.',
    'state.errorLead': 'Bu sık oluyorsa bağlantını kontrol et.'
};
