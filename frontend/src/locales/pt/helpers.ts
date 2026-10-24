import type { Dictionary } from '../en/index.ts';
import type { helpers as reference } from '../en/helpers.ts';

export const helpers: Pick<Dictionary, keyof typeof reference> = {
    'helpers.title': 'Ajudas de jogo',
    'helpers.lead': 'Uma mãozinha enquanto você joga. Cada uma pode ser desligada aqui ou no menu da mesa.',
    'helpers.moves': 'Mostrar o que dá para jogar',
    'helpers.movesHint': 'Destaca as peças e cartas que você pode mexer agora.',
    'helpers.outcome': 'Dizer o que a jogada faz',
    'helpers.outcomeHint': 'Antes de confirmar, diz se a jogada captura, leva a vaza ou tira a pedra do tabuleiro.',
    'helpers.rules': 'Treinador de regras',
    'helpers.rulesHint': 'Uma dica curta sobre a regra que importa agora.',
    'helpers.tip': 'Dica',
    'helpers.moves.show': 'Mostrar o que posso jogar',
    'helpers.moves.hide': 'Esconder o que posso jogar',
    'helpers.outcome.show': 'Dizer o que a jogada faz',
    'helpers.outcome.hide': 'Parar de dizer o que a jogada faz',
    'helpers.rules.show': 'Ligar o treinador de regras',
    'helpers.rules.hide': 'Desligar o treinador de regras'
};
