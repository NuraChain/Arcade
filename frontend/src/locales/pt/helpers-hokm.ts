import type { Dictionary } from '../en/index.ts';
import type { helpersHokm as reference } from '../en/helpers-hokm.ts';

export const helpersHokm: Pick<Dictionary, keyof typeof reference> = {
    'helpers.hokm.lead': 'Abre a vaza.',
    'helpers.hokm.lead.trump': 'Abre com trunfo: todo mundo tem que jogar trunfo enquanto tiver.',
    'helpers.hokm.ahead': 'Está levando a vaza por enquanto.',
    'helpers.hokm.ahead.trump': 'Um trunfo, e está levando a vaza por enquanto.',
    'helpers.hokm.wins': 'Leva a vaza.',
    'helpers.hokm.wins.trump': 'Um trunfo, e leva a vaza.',
    'helpers.hokm.loses': 'Não leva esta vaza.',
    'helpers.hokm.loses.trump': 'Um trunfo, mas já tem um trunfo maior na mesa.',
    'helpers.hokm.tip.name': 'Escolha o naipe que você mais tem. O trunfo ganha de todos os outros naipes pelo resto da mão.',
    'helpers.hokm.tip.name.clubs': 'Você tem mais paus do que qualquer outro naipe. O hakem costuma escolher o naipe que mais tem.',
    'helpers.hokm.tip.name.diamonds': 'Você tem mais ouros do que qualquer outro naipe. O hakem costuma escolher o naipe que mais tem.',
    'helpers.hokm.tip.name.hearts': 'Você tem mais copas do que qualquer outro naipe. O hakem costuma escolher o naipe que mais tem.',
    'helpers.hokm.tip.name.spades': 'Você tem mais espadas do que qualquer outro naipe. O hakem costuma escolher o naipe que mais tem.',
    'helpers.hokm.tip.wait': 'O hakem escolhe o trunfo com as cinco primeiras cartas. O resto da distribuição espera até ele escolher.',
    'helpers.hokm.tip.wait.draw': 'O hakem escolhe o trunfo com as cinco primeiras cartas. Depois vocês dois descartam cartas viradas para baixo e compram do monte até cada um ter treze.',
    'helpers.hokm.tip.away': 'Descarte as cartas que menos vão fazer falta: as baixas, e nenhuma do naipe de trunfo se der. Toque nelas para levantar e depois toque no monte.',
    'helpers.hokm.tip.keep': 'Vale guardar: um trunfo, ou um dez para cima. Toque na carta para ficar com ela, e a próxima vai virada para baixo.',
    'helpers.hokm.tip.pass': 'Uma carta baixa fora do trunfo. Toque no monte para passá-la virada para baixo, e você tem que ficar com a próxima, seja qual for.',
    'helpers.hokm.tip.lead': 'Você abre, então qualquer carta pode começar a vaza. Todo mundo tem que seguir o naipe dela enquanto tiver.',
    'helpers.hokm.tip.trump': 'Você não tem o naipe que saiu, então vale qualquer carta, e um trunfo leva a vaza a não ser que um maior ganhe dele.',
    'helpers.hokm.tip.discard': 'Você não tem o naipe que saiu nem trunfo, então nenhuma carta sua leva esta vaza. Jogue uma que não vai fazer falta.'
};
