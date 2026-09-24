import type { Dictionary } from '../en/index.ts';
import type { helpersLudo as reference } from '../en/helpers-ludo.ts';

export const helpersLudo: Pick<Dictionary, keyof typeof reference> = {
    'helpers.ludo.move.capture': {
        one: 'با مهرهٔ {token}، مهرهٔ {name} را بزن',
        other: 'با مهرهٔ {token}، {count} مهرهٔ {name} را بزن'
    },
    'helpers.ludo.move.safe': 'مهرهٔ {token} را روی ستارهٔ امن ببر',
    'helpers.ludo.hint.move': 'روی مهره‌ای که می‌تواند حرکت کند بزن، یا از پایین انتخاب کن.',
    'helpers.ludo.tip.yard': 'هیچ مهره‌ای روی مسیر نیست؛ فقط با شش یکی از خانه بیرون می‌آید.',
    'helpers.ludo.tip.six': 'شش آوردی؛ بعد از این حرکت دوباره تاس می‌ریزی.',
    'helpers.ludo.tip.threeSixes': 'سه شش پشت سر هم نوبت را تمام می‌کند و ششِ سوم بازی نمی‌شود.',
    'helpers.ludo.tip.star': 'ستاره‌ها امن‌اند؛ مهره‌ای که روی ستاره ایستاده زده نمی‌شود.',
    'helpers.ludo.tip.exact': 'رسیدن به خانه عددِ دقیق می‌خواهد؛ مهره‌ای که برای این تاس خیلی نزدیک است سر جایش می‌ماند.'
};
