import type { Dictionary } from '../en/index.ts';
import type { helpers as reference } from '../en/helpers.ts';

export const helpers: Pick<Dictionary, keyof typeof reference> = {
    'helpers.title': 'مساعدات اللعب',
    'helpers.lead': 'مساعدة وأنت تلعب. يمكن إيقاف كل واحدة منها من هنا أو من قائمة الطاولة.',
    'helpers.moves': 'أظهر ما يمكنك لعبه',
    'helpers.movesHint': 'تضيء القطع والأوراق التي يمكنك تحريكها الآن.',
    'helpers.outcome': 'اشرح ما تفعله الحركة',
    'helpers.outcomeHint': 'قبل أن تؤكد، تخبرك إن كانت الحركة تأسر قطعة أو تكسب الأكلة أو تُخرج قطعة من اللوح.',
    'helpers.rules': 'مدرّب القواعد',
    'helpers.rulesHint': 'نصيحة قصيرة عن القاعدة المهمة الآن.',
    'helpers.tip': 'نصيحة',
    'helpers.moves.show': 'أظهر ما يمكنني لعبه',
    'helpers.moves.hide': 'أخفِ ما يمكنني لعبه',
    'helpers.outcome.show': 'اشرح ما تفعله الحركة',
    'helpers.outcome.hide': 'توقّف عن شرح الحركات',
    'helpers.rules.show': 'شغّل مدرّب القواعد',
    'helpers.rules.hide': 'أوقف مدرّب القواعد'
};
