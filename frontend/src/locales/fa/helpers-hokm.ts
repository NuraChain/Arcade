import type { Dictionary } from '../en/index.ts';
import type { helpersHokm as reference } from '../en/helpers-hokm.ts';

export const helpersHokm: Pick<Dictionary, keyof typeof reference> = {
    'helpers.hokm.lead': 'این دست را شروع می‌کند.',
    'helpers.hokm.lead.trump': 'با حکم شروع می‌کند: هر کس حکم دارد باید حکم بیندازد.',
    'helpers.hokm.ahead': 'فعلاً این دست را می‌برد.',
    'helpers.hokm.ahead.trump': 'حکم است و فعلاً این دست را می‌برد.',
    'helpers.hokm.wins': 'این دست را می‌برد.',
    'helpers.hokm.wins.trump': 'حکم است و این دست را می‌برد.',
    'helpers.hokm.loses': 'این دست را نمی‌برد.',
    'helpers.hokm.loses.trump': 'حکم است، ولی حکم بالاتری روی میز است.',
    'helpers.hokm.tip.name': 'خالی را حکم کن که بیشترین کارتش را داری. حکم تا آخر این دور از همهٔ خال‌های دیگر بالاتر است.',
    'helpers.hokm.tip.name.clubs': 'از گشنیز بیشتر از هر خال دیگری کارت داری. حاکم معمولاً خالی را حکم می‌کند که بیشترین کارتش را دارد.',
    'helpers.hokm.tip.name.diamonds': 'از خشت بیشتر از هر خال دیگری کارت داری. حاکم معمولاً خالی را حکم می‌کند که بیشترین کارتش را دارد.',
    'helpers.hokm.tip.name.hearts': 'از دل بیشتر از هر خال دیگری کارت داری. حاکم معمولاً خالی را حکم می‌کند که بیشترین کارتش را دارد.',
    'helpers.hokm.tip.name.spades': 'از پیک بیشتر از هر خال دیگری کارت داری. حاکم معمولاً خالی را حکم می‌کند که بیشترین کارتش را دارد.',
    'helpers.hokm.tip.wait': 'حاکم از روی پنج کارت اولش حکم را می‌گوید. بقیهٔ کارت‌ها بعد از آن پخش می‌شود.',
    'helpers.hokm.tip.lead': 'نوبت شروع با توست؛ هر کارتی می‌توانی بیندازی و بقیه تا وقتی از آن خال دارند باید همان را بازی کنند.',
    'helpers.hokm.tip.trump': 'از خالی که رو شده کارتی نداری؛ هر کارتی می‌توانی بیندازی و حکم این دست را می‌برد، مگر حکم بالاتری در کار باشد.',
    'helpers.hokm.tip.discard': 'نه از خال رو شده کارتی داری و نه حکم، پس هیچ‌کدام از کارت‌هایت این دست را نمی‌برد. کارتی بینداز که لازمش نداری.'
};
