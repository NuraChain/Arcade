import type { Dictionary } from '../en/index.ts';
import type { helpersBackgammon as reference } from '../en/helpers-backgammon.ts';

export const helpersBackgammon: Pick<Dictionary, keyof typeof reference> = {
    'helpers.backgammon.bar': 'बार पर पड़ी गोटी पहले वापस आती है। जब तक वह अंदर न आ जाए, कुछ और नहीं चलता।',
    'helpers.backgammon.doubles': 'जोड़ी चार बार खेली जाती है: {die} की चार चालें।',
    'helpers.backgammon.both': 'जब हो सके दोनों पासे खेलने होते हैं, इसलिए ऐसी चाल नहीं दी जाती जिससे दूसरे पासे के लिए कोई जगह न बचे।',
    'helpers.backgammon.higher': 'यहाँ सिर्फ़ एक पासा खेला जा सकता है, और जब दोनों में से कोई भी फ़िट हो तो बड़ा वाला खेलना होगा: {die}।',
    'helpers.backgammon.bear': 'तुम्हारी सारी गोटियाँ घर में हैं, अब उन्हें बाहर निकालना शुरू कर सकते हो।',
    'helpers.backgammon.double': 'पासा फेंकने से पहले डबल कर सकते हो: क्यूब पर टैप करो। फिर सामने वाला {cube} पर खेलेगा या यह गेम छोड़ देगा।',
    'helpers.backgammon.take': 'मान लो तो यह गेम {cube} पर चलता रहेगा। छोड़ दो तो यह अभी {now} पर ख़त्म हो जाएगा।'
};
