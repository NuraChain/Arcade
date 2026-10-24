import type { Dictionary } from '../en/index.ts';
import type { app as reference } from '../en/app.ts';

export const app: Pick<Dictionary, keyof typeof reference> = {
    'app.title': 'بازيچه',

    'app.nav.home': 'الرئيسية',
    'app.nav.games': 'الألعاب',
    'app.nav.watch': 'مشاهدة',
    'app.nav.friends': 'الأصدقاء',
    'app.nav.chats': 'الدردشات',
    'app.nav.profile': 'الملف الشخصي',
    'app.nav.leaderboard': 'المتصدرون',
    'app.nav.discover': 'استكشف',
    'app.nav.search': 'بحث',
    'app.nav.notifications': 'الإشعارات',
    'app.nav.settings': 'الإعدادات',
    'app.nav.back': 'رجوع',
    'app.nav.primary': 'التنقل الرئيسي',
    'app.nav.signOut': 'تسجيل الخروج',
    'create.title': 'أنشئ طاولة',
    'app.nav.quickPlay': 'لعب سريع',
    'app.sidebar.collapse': 'طيّ القائمة',
    'app.sidebar.expand': 'توسيع القائمة',
    'app.search.placeholder': 'ابحث عن ألعاب، أشخاص، مجموعات…',

    'shell.panel': 'النشاط والأصدقاء',
    'shell.activity': 'النشاط',
    'shell.activity.empty': 'طلبات الصداقة والدعوات والرسائل تصل إلى هنا.',
    'shell.friends.empty': 'لا أحد من أصدقائك متصل الآن.',

    'common.cancel': 'إلغاء',
    'common.more': 'المزيد',
    'common.retry': 'حاول مجددًا',
    'common.loading': 'جارٍ التحميل…',
    'common.close': 'إغلاق',
    'common.clear': 'مسح',
    'common.seeAll': 'عرض الكل',
    'common.you': 'أنت',
    'common.listJoin': '، ',
    'common.online': 'متصل',
    'common.away': 'بعيد',
    'common.players': { zero: 'لا لاعبين', one: 'لاعب واحد', two: 'لاعبان', few: '{count} لاعبين', many: '{count} لاعبًا', other: '{count} لاعب' },
    'common.unread': { zero: 'لا رسائل غير مقروءة', one: 'رسالة غير مقروءة', two: 'رسالتان غير مقروءتين', few: '{count} رسائل غير مقروءة', many: '{count} رسالة غير مقروءة', other: '{count} رسالة غير مقروءة' },
    'common.requests': { zero: 'لا طلبات صداقة', one: 'طلب صداقة واحد', two: 'طلبا صداقة', few: '{count} طلبات صداقة', many: '{count} طلب صداقة', other: '{count} طلب صداقة' },
    'common.notices': { zero: 'لا إشعارات جديدة', one: 'إشعار جديد', two: 'إشعاران جديدان', few: '{count} إشعارات جديدة', many: '{count} إشعارًا جديدًا', other: '{count} إشعار جديد' },
    'common.waitingTables': { zero: 'لا طاولات بانتظارك', one: 'طاولة واحدة بانتظارك', two: 'طاولتان بانتظارك', few: '{count} طاولات بانتظارك', many: '{count} طاولة بانتظارك', other: '{count} طاولة بانتظارك' },
    'common.optional': 'اختياري',
    'common.actionFailed': 'لم يتم ذلك. حاول مجددًا.',
    'common.copyFailed': 'هذا المتصفح لم ينسخه. حدّده وانسخه يدويًا.',
    'page.range': '{from}–{to} من {total}',
    'page.previous': 'الصفحة السابقة',
    'page.next': 'الصفحة التالية',
    'page.of': '{page} من {pages}',
    'page.go': 'الصفحة {page}',
    'page.more': 'اعرض {count} أخرى',
    'page.shown': 'يُعرض {shown} من {total}',

    'toast.dismiss': 'تجاهل',
    'toast.region': 'الإشعارات',
    'toast.more': '{count} أخرى…',

    'app.refreshing': 'جارٍ التحديث…',

    'cue.chatBody': 'أرسل {who} رسالة',
    'cue.requestBody': 'يريد {who} أن يكون صديقك',
    'cue.open': 'افتح',
    'cue.view': 'عرض',
    'cue.requests': 'الطلبات',

    'overlay.handle': 'اسحب للأسفل للإغلاق',

    'connection.offline': 'أنت غير متصل. الطاولات المباشرة تواصل اللعب من دونك.',
    'connection.reconnecting': 'انقطع الاتصال. جارٍ إعادة الاتصال…',
    'connection.unreached': 'التحديثات المباشرة لا تصل. تتحقق هذه الصفحة من التغييرات كل بضع ثوانٍ.',
    'connection.restored': 'عدت متصلًا.',

    'notice.close': 'أغلق هذا الإعلان',
    'notice.gotIt': 'فهمت',

    'state.errorTitle': 'تعذّر تحميل هذا.',
    'state.errorLead': 'إن تكرر هذا، فتحقق من اتصالك.'
};
