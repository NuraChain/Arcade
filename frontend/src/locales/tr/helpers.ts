import type { Dictionary } from '../en/index.ts';
import type { helpers as reference } from '../en/helpers.ts';

export const helpers: Pick<Dictionary, keyof typeof reference> = {
    'helpers.title': 'Oyun yardımcıları',
    'helpers.lead': 'Oynarken yardım. Her birini buradan ya da masa menüsünden kapatabilirsin.',
    'helpers.moves': 'Oynayabileceklerimi göster',
    'helpers.movesHint': 'Şu an oynatabileceğin taşları ve kartları parlat.',
    'helpers.outcome': 'Hamlenin ne yapacağını söyle',
    'helpers.outcomeHint': 'Karar vermeden önce taş alıp almadığını, eli alıp almadığını ya da pulu toplayıp toplamadığını söyle.',
    'helpers.rules': 'Kural koçu',
    'helpers.rulesHint': 'O an önemli olan kural hakkında kısa bir ipucu.',
    'helpers.tip': 'İpucu',
    'helpers.moves.show': 'Oynayabileceklerimi göster',
    'helpers.moves.hide': 'Oynayabileceklerimi gizle',
    'helpers.outcome.show': 'Hamlenin ne yapacağını söyle',
    'helpers.outcome.hide': 'Hamlenin ne yapacağını söyleme',
    'helpers.rules.show': 'Kural koçunu aç',
    'helpers.rules.hide': 'Kural koçunu kapat'
};
