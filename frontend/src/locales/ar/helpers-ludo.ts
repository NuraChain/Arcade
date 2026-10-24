import type { Dictionary } from '../en/index.ts';
import type { helpersLudo as reference } from '../en/helpers-ludo.ts';

export const helpersLudo: Pick<Dictionary, keyof typeof reference> = {
    'helpers.ludo.tip.yard': 'لا قطعة لك على المسار: وحدها الستة تُخرج قطعة من القاعدة.',
    'helpers.ludo.tip.six': 'ستة: بعد هذه الحركة ترمي مرة أخرى.',
    'helpers.ludo.tip.threeSixes': 'ثلاث ستات متتالية تنهي الدور، والثالثة لا تُلعب.',
    'helpers.ludo.tip.star': 'النجوم آمنة: النزول على إحداها لا يعيد أحدًا إلى القاعدة. وحدها القطعة الخارجة إلى مربع بدايتها تفعل ذلك.',
    'helpers.ludo.tip.blocked': 'قطعتان من لون واحد تصنعان حاجزًا: لا يستطيع أي لون آخر النزول عليه أو تجاوزه، ولا تنضم إليه قطعة ثالثة.',
    'helpers.ludo.tip.blockedTeams': 'قطعتان من فريق واحد تصنعان حاجزًا، حتى لو كانتا لشريكين: لا يستطيع أي خصم النزول عليه أو تجاوزه، ولا تنضم إليه قطعة ثالثة.',
    'helpers.ludo.tip.partner': 'الشريكان لا يعيد أحدهما الآخر إلى القاعدة أبدًا: النزول على شريكك يصنع حاجزًا.',
    'helpers.ludo.tip.helping': 'قطعك الأربع وصلت إلى البيت، فكل رمية لك الآن تحرّك قطع شريكك. والستة ما زالت تمنحك رمية أخرى.',
    'helpers.ludo.tip.start': 'مربع البداية يتسع لقطعة واحدة من لونه في كل مرة: حرّكها قبل أن تُخرج أخرى.',
    'helpers.ludo.tip.exact': 'الوصول إلى البيت يحتاج العدد بالضبط، فالقطعة الأقرب من هذه الرمية تبقى مكانها.'
};
