import type { Dictionary } from '../en/index.ts';
import type { helpersChess as reference } from '../en/helpers-chess.ts';

export const helpersChess: Pick<Dictionary, keyof typeof reference> = {
    'helpers.chess.tip.first': 'تبدأ ساعتك بعد حركتك الأولى. العبها خلال 30 ثانية، وإلا أُلغيت اللعبة ولم تُحسب لأحد.',
    'helpers.chess.tip.waitFirst': 'إن لم يلعب الخصم حركته الأولى خلال 30 ثانية، تُلغى اللعبة ولا تُحسب لأحد.',
    'helpers.chess.tip.check': 'ملكك في كش: حرّك الملك، أو ضع قطعة في الطريق، أو خذ القطعة التي تهدده.',
    'helpers.chess.tip.checkKing': 'لا يخرج من هذا الكش إلا الملك نفسه: حرّكه إلى مربع لا يهاجمه شيء.',
    'helpers.chess.tip.promote': 'البيدق الذي يصل إلى الصف الأخير يصبح وزيرًا أو رخًا أو فيلًا أو حصانًا. الاختيار لك.',
    'helpers.chess.tip.passant': 'البيدق الذي تقدّم مربعين للتو يمكن أخذه في الطريق، كأنه تقدّم مربعًا واحدًا. في هذه الحركة فقط.',
    'helpers.chess.tip.time': 'بقيت أقل من دقيقة. إن نفد وقتك تخسر، إلا إن لم يبقَ لدى خصمك ما يكفي لإعطاء كش مات.',
    'helpers.chess.tip.castle': 'يمكنك التبييت: حرّك ملكك مربعين نحو الرخ، فيقفز الرخ فوقه.',
    'helpers.chess.tip.fifty': 'خمسون حركة لكل طرف دون أسر ودون تحريك بيدق تنهي اللعبة بالتعادل، وهذه اللعبة قريبة من ذلك.'
};
