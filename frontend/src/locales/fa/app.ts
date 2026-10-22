import type { Dictionary } from '../en/index.ts';
import type { app as reference } from '../en/app.ts';

export const app: Pick<Dictionary, keyof typeof reference> = {
    'app.title': 'بازیچه',

    'app.nav.home': 'خانه',
    'app.nav.games': 'بازی‌ها',
    'app.nav.watch': 'تماشا',
    'app.nav.friends': 'دوستان',
    'app.nav.chats': 'چت‌ها',
    'app.nav.profile': 'پروفایل',
    'app.nav.leaderboard': 'برترین‌ها',
    'app.nav.discover': 'اکسپلور',
    'app.nav.search': 'جست‌وجو',
    'app.nav.notifications': 'اعلان‌ها',
    'app.nav.settings': 'تنظیمات',
    'app.nav.back': 'برگشت',
    'app.nav.primary': 'منوی اصلی',
    'app.nav.signOut': 'خروج',
    'create.title': 'ساخت میز',
    'app.nav.quickPlay': 'بازی سریع',
    'app.sidebar.collapse': 'جمع کردن منو',
    'app.sidebar.expand': 'باز کردن منو',
    'app.search.placeholder': 'دنبال بازی، آدم یا گروه بگرد…',

    'shell.panel': 'فعالیت و دوستان',
    'shell.activity': 'فعالیت‌ها',
    'shell.activity.empty': 'درخواست‌های دوستی، دعوت‌ها و پیام‌ها این‌جا میان.',
    'shell.friends.empty': 'الان هیچ‌کدوم از دوستات آنلاین نیستن.',

    'common.cancel': 'لغو',
    'common.more': 'بیشتر',
    'common.retry': 'دوباره امتحان کن',
    'common.loading': 'در حال بارگذاری…',
    'common.close': 'بستن',
    'common.clear': 'پاک کردن',
    'common.seeAll': 'دیدن همه',
    'common.you': 'تو',
    'common.listJoin': '، ',
    'common.online': 'آنلاین',
    'common.away': 'در دسترس نیست',
    'common.players': { one: '{count} بازیکن', other: '{count} بازیکن' },
    'common.unread': { one: '{count} خوانده‌نشده', other: '{count} خوانده‌نشده' },
    'common.requests': { one: '{count} درخواست دوستی', other: '{count} درخواست دوستی' },
    'common.notices': { one: '{count} اعلان جدید', other: '{count} اعلان جدید' },
    'common.waitingTables': { one: '{count} میز منتظرته', other: '{count} میز منتظرته' },
    'common.optional': 'اختیاری',
    'common.actionFailed': 'نشد. یه بار دیگه امتحان کن.',
    'common.copyFailed': 'مرورگر کپی نکرد. خودت انتخابش کن و کپی کن.',
    'page.range': '{from} تا {to} از {total}',
    'page.previous': 'صفحه‌ی قبل',
    'page.next': 'صفحه‌ی بعد',
    'page.of': '{page} از {pages}',
    'page.go': 'صفحه‌ی {page}',
    'page.more': '{count} تای دیگه رو نشون بده',
    'page.shown': '{shown} تا از {total} تا',

    'toast.dismiss': 'بستن',
    'toast.region': 'اعلان‌ها',
    'toast.more': '{count} تای دیگه…',

    'app.refreshing': 'داره به‌روز می‌شه…',

    'cue.chatBody': '{who} یه پیام فرستاد',
    'cue.requestBody': '{who} می‌خواد باهات دوست بشه',
    'cue.open': 'باز کن',
    'cue.view': 'ببین',
    'cue.requests': 'درخواست‌ها',

    'overlay.handle': 'واسه بستن بکش پایین',

    'connection.offline': 'آفلاینی. میزهای زنده بدون تو ادامه پیدا می‌کنن.',
    'connection.reconnecting': 'اتصال قطع شد. داریم دوباره وصل می‌شیم…',
    'connection.unreached': 'به‌روزرسانی زنده نمی‌رسه. این صفحه هر چند ثانیه یه بار خودش سر می‌زنه.',
    'connection.restored': 'دوباره آنلاین شدی.',

    'notice.close': 'بستن اطلاعیه',
    'notice.gotIt': 'فهمیدم',

    'state.errorTitle': 'این بخش بالا نیومد.',
    'state.errorLead': 'اگه بازم این‌طوری شد، اینترنتت رو چک کن.'
};
