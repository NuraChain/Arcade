import type { Dictionary } from '../en/index.ts';
import type { app as reference } from '../en/app.ts';

export const app: Pick<Dictionary, keyof typeof reference> = {
    'app.title': 'बाज़ीचे',

    'app.nav.home': 'होम',
    'app.nav.games': 'गेम्स',
    'app.nav.watch': 'देखो',
    'app.nav.friends': 'दोस्त',
    'app.nav.chats': 'चैट',
    'app.nav.profile': 'प्रोफ़ाइल',
    'app.nav.leaderboard': 'लीडरबोर्ड',
    'app.nav.discover': 'खोजो',
    'app.nav.search': 'सर्च',
    'app.nav.notifications': 'नोटिफ़िकेशन',
    'app.nav.settings': 'सेटिंग्स',
    'app.nav.back': 'वापस',
    'app.nav.primary': 'मुख्य नेविगेशन',
    'app.nav.signOut': 'साइन आउट',
    'create.title': 'टेबल बनाओ',
    'app.nav.quickPlay': 'क्विक प्ले',
    'app.sidebar.collapse': 'मेन्यू छोटा करो',
    'app.sidebar.expand': 'मेन्यू बड़ा करो',
    'app.search.placeholder': 'गेम, लोग, ग्रुप सर्च करो…',

    'shell.panel': 'गतिविधि और दोस्त',
    'shell.activity': 'गतिविधि',
    'shell.activity.empty': 'फ्रेंड रिक्वेस्ट, न्योते और मैसेज यहीं आते हैं।',
    'shell.friends.empty': 'अभी तुम्हारा कोई दोस्त ऑनलाइन नहीं है।',

    'common.cancel': 'रद्द करो',
    'common.more': 'और',
    'common.retry': 'फिर से कोशिश करो',
    'common.loading': 'लोड हो रहा है…',
    'common.close': 'बंद करो',
    'common.clear': 'साफ़ करो',
    'common.seeAll': 'सब देखो',
    'common.you': 'तुम',
    'common.listJoin': ', ',
    'common.online': 'ऑनलाइन',
    'common.away': 'दूर',
    'common.players': { one: '{count} खिलाड़ी', other: '{count} खिलाड़ी' },
    'common.unread': { one: '{count} अनपढ़ा', other: '{count} अनपढ़े' },
    'common.requests': { one: '{count} फ्रेंड रिक्वेस्ट', other: '{count} फ्रेंड रिक्वेस्ट' },
    'common.notices': { one: '{count} नया नोटिफ़िकेशन', other: '{count} नए नोटिफ़िकेशन' },
    'common.waitingTables': { one: '{count} टेबल तुम्हारा इंतज़ार कर रही है', other: '{count} टेबलें तुम्हारा इंतज़ार कर रही हैं' },
    'common.optional': 'वैकल्पिक',
    'common.actionFailed': 'यह नहीं हो पाया। फिर से कोशिश करो।',
    'common.copyFailed': 'यह ब्राउज़र इसे कॉपी नहीं कर पाया। इसे चुनकर ख़ुद कॉपी कर लो।',
    'page.range': '{total} में से {from}–{to}',
    'page.previous': 'पिछला पेज',
    'page.next': 'अगला पेज',
    'page.of': '{pages} में से {page}',
    'page.go': 'पेज {page}',
    'page.more': '{count} और दिखाओ',
    'page.shown': '{total} में से {shown} दिख रहे हैं',

    'toast.dismiss': 'हटाओ',
    'toast.region': 'नोटिफ़िकेशन',
    'toast.more': '{count} और…',

    'app.refreshing': 'रिफ़्रेश हो रहा है…',

    'cue.chatBody': '{who} ने मैसेज भेजा',
    'cue.requestBody': '{who} तुम्हारा दोस्त बनना चाहता है',
    'cue.open': 'खोलो',
    'cue.view': 'देखो',
    'cue.requests': 'रिक्वेस्ट',

    'overlay.handle': 'बंद करने के लिए नीचे खींचो',

    'connection.offline': 'तुम ऑफ़लाइन हो। लाइव टेबलों पर खेल तुम्हारे बिना चलता रहेगा।',
    'connection.reconnecting': 'कनेक्शन टूट गया। फिर से जुड़ रहे हैं…',
    'connection.unreached': 'लाइव अपडेट नहीं पहुँच रहे। यह पेज हर कुछ सेकंड में बदलाव देख लेता है।',
    'connection.restored': 'फिर से ऑनलाइन।',

    'notice.close': 'यह घोषणा बंद करो',
    'notice.gotIt': 'समझ गया',

    'state.errorTitle': 'यह लोड नहीं हो पाया।',
    'state.errorLead': 'अगर ऐसा बार-बार हो, तो अपना कनेक्शन देख लो।'
};
