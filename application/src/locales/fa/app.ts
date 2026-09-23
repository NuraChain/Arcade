import type { Dictionary } from '../en/index.ts';
import type { app as reference } from '../en/app.ts';

export const app: Pick<Dictionary, keyof typeof reference> = {
    'app.title': 'بازی‌های نورا',

    'app.nav.home': 'خانه',
    'app.nav.games': 'بازی‌ها',
    'app.nav.friends': 'دوستان',
    'app.nav.chats': 'گفت‌وگوها',
    'app.nav.profile': 'پروفایل',
    'app.nav.leaderboard': 'جدول امتیاز',
    'app.nav.discover': 'کشف',
    'app.nav.search': 'جست‌وجو',
    'app.nav.notifications': 'اعلان‌ها',
    'app.nav.settings': 'تنظیمات',
    'app.nav.back': 'بازگشت',
    'app.nav.primary': 'ناوبری اصلی',
    'app.nav.signOut': 'خروج',
    'create.title': 'ساختن میز',
    'app.nav.quickPlay': 'بازی سریع',
    'app.sidebar.collapse': 'جمع کردن منو',
    'app.sidebar.expand': 'باز کردن منو',
    'app.search.placeholder': 'جست‌وجوی بازی، آدم یا گروه…',

    'shell.panel': 'فعالیت و دوستان',
    'shell.activity': 'فعالیت‌ها',
    'shell.activity.empty': 'درخواست‌های دوستی، دعوت‌ها و پیام‌ها این‌جا می‌آیند.',
    'shell.friends.empty': 'هیچ‌کدام از دوستانت الان آنلاین نیستند.',

    'signIn.continue': 'نشستن به نام {name}',
    'signIn.handle': 'نام تو',
    'signIn.handleHint': 'دست‌کم سه حرف یا رقم. دوستانت این نام را سر میز می‌بینند.',
    'signIn.handleShort': 'نام باید دست‌کم سه حرف یا رقم داشته باشد.',
    'signIn.handleShape': 'حرف و رقم، و در میانش . _ یا - . نمی‌تواند با اینها شروع یا تمام شود.',
    'signIn.handleReserved': 'این نام برای خودِ محصول نگه داشته شده. یکی دیگر بردار.',
    'signIn.handleRefused': 'این نام پذیرفته نشد. یکی دیگر بردار.',
    'signIn.failed': 'نشد. اتصالت را ببین و دوباره تلاش کن.',

    'common.cancel': 'لغو',
    'common.more': 'بیشتر',
    'common.retry': 'دوباره تلاش کن',
    'common.loading': 'در حال بارگذاری…',
    'common.close': 'بستن',
    'common.clear': 'پاک کردن',
    'common.seeAll': 'همه',
    'common.you': 'تو',
    'common.listJoin': '، ',
    'common.online': 'آنلاین',
    'common.away': 'دور از دسترس',
    'common.players': { one: '{count} بازیکن', other: '{count} بازیکن' },
    'common.friendsOnline': { one: '{count} دوست آنلاین', other: '{count} دوست آنلاین' },
    'common.unread': { one: '{count} خوانده‌نشده', other: '{count} خوانده‌نشده' },
    'common.requests': { one: '{count} درخواست دوستی', other: '{count} درخواست دوستی' },
    'common.waitingTables': { one: '{count} میز منتظر توست', other: '{count} میز منتظر توست' },
    'common.optional': 'اختیاری',
    'page.range': '{from} تا {to} از {total}',
    'page.previous': 'صفحهٔ قبل',
    'page.next': 'صفحهٔ بعد',
    'page.of': '{page} از {pages}',
    'page.go': 'صفحهٔ {page}',
    'page.more': 'نمایش {count} مورد دیگر',

    'toast.dismiss': 'بستن',
    'toast.region': 'اعلان‌ها',
    'toast.more': '{count} مورد دیگر…',

    'app.refreshing': 'در حال تازه‌سازی…',

    'overlay.handle': 'برای بستن به پایین بکش',

    'connection.offline': 'آفلاین هستی. میزها تا برگشتنت صبر می‌کنند.',
    'connection.reconnecting': 'اتصال قطع شد. در حال اتصال دوباره…',
    'connection.restored': 'دوباره آنلاین شدی.',

    'keys.banner.absent': 'این مرورگر هنوز نمی‌تواند پیام‌هایت را بخواند.',
    'keys.banner.absentAction': 'کلید بگیرد',
    'keys.banner.waiting': 'این مرورگر منتظر تأیید است.',
    'keys.banner.waitingAction': 'تأییدش کن',
    'keys.banner.dismiss': 'الان نه',

    'state.errorTitle': 'این بخش بارگذاری نشد.',
    'state.errorLead': 'اگر ادامه داشت، اتصالت را بررسی کن.'
};
