import type { Dictionary } from '../en/index.ts';
import type { helpers as reference } from '../en/helpers.ts';

export const helpers: Pick<Dictionary, keyof typeof reference> = {
    'helpers.title': 'गेम हेल्पर',
    'helpers.lead': 'खेलते समय मदद। हर एक को यहाँ से या टेबल के मेन्यू से बंद कर सकते हो।',
    'helpers.moves': 'दिखाओ कि क्या खेल सकते हो',
    'helpers.movesHint': 'जो मोहरे और पत्ते तुम अभी चल सकते हो, उन्हें चमकाओ।',
    'helpers.outcome': 'बताओ कि चाल से क्या होगा',
    'helpers.outcomeHint': 'पक्का करने से पहले बताओ कि इससे मोहरा कटेगा, हाथ जीता जाएगा या गोटी बाहर निकलेगी।',
    'helpers.rules': 'नियम कोच',
    'helpers.rulesHint': 'अभी जो नियम मायने रखता है, उसके बारे में एक छोटी टिप।',
    'helpers.tip': 'टिप',
    'helpers.moves.show': 'दिखाओ कि मैं क्या खेल सकता हूँ',
    'helpers.moves.hide': 'छिपाओ कि मैं क्या खेल सकता हूँ',
    'helpers.outcome.show': 'बताओ कि चाल से क्या होगा',
    'helpers.outcome.hide': 'चाल का नतीजा बताना बंद करो',
    'helpers.rules.show': 'नियम कोच चालू करो',
    'helpers.rules.hide': 'नियम कोच बंद करो'
};
