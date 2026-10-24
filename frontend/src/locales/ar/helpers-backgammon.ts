import type { Dictionary } from '../en/index.ts';
import type { helpersBackgammon as reference } from '../en/helpers-backgammon.ts';

export const helpersBackgammon: Pick<Dictionary, keyof typeof reference> = {
    'helpers.backgammon.bar': 'القطعة المضروبة على الحاجز تدخل أولًا. لا يتحرك شيء آخر حتى تدخل.',
    'helpers.backgammon.doubles': 'الدوبيش يُلعب أربع مرات: أربع حركات بقيمة {die}.',
    'helpers.backgammon.both': 'يجب لعب الزهرين معًا متى أمكن، لذلك لا تُعرض حركة تترك الزهر الآخر بلا مكان يذهب إليه.',
    'helpers.backgammon.higher': 'لا يمكن لعب إلا زهر واحد هنا، وإن صلح أيّ منهما فيجب لعب الأعلى: {die}.',
    'helpers.backgammon.bear': 'كل قطعك في البيت، فيمكنك البدء بإخراجها.',
    'helpers.backgammon.double': 'قبل أن ترمي يمكنك المضاعفة: انقر المكعب. عندها يكمل خصمك على {cube} أو يستسلم في هذه اللعبة.',
    'helpers.backgammon.take': 'اقبل وتستمر هذه اللعبة على {cube}. استسلم وتنتهي الآن على {now}.'
};
