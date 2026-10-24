import type { Dictionary } from '../en/index.ts';
import type { helpers as reference } from '../en/helpers.ts';

export const helpers: Pick<Dictionary, keyof typeof reference> = {
    'helpers.title': 'Подсказки в игре',
    'helpers.lead': 'Помощь прямо во время игры. Каждую можно выключить здесь или в меню стола.',
    'helpers.moves': 'Показывать возможные ходы',
    'helpers.movesHint': 'Подсвечивать фигуры и карты, которыми можно сходить прямо сейчас.',
    'helpers.outcome': 'Объяснять, что даст ход',
    'helpers.outcomeHint': 'Перед ходом подсказать, будет ли взятие, заберёт ли карта взятку и выйдет ли шашка с доски.',
    'helpers.rules': 'Тренер по правилам',
    'helpers.rulesHint': 'Короткая подсказка о правиле, которое важно прямо сейчас.',
    'helpers.tip': 'Подсказка',
    'helpers.moves.show': 'Показать возможные ходы',
    'helpers.moves.hide': 'Скрыть возможные ходы',
    'helpers.outcome.show': 'Объяснять, что даст ход',
    'helpers.outcome.hide': 'Не объяснять, что даст ход',
    'helpers.rules.show': 'Включить тренера по правилам',
    'helpers.rules.hide': 'Выключить тренера по правилам'
};
