import type { Dictionary } from '../en/index.ts';
import type { helpersLudo as reference } from '../en/helpers-ludo.ts';

export const helpersLudo: Pick<Dictionary, keyof typeof reference> = {
    'helpers.ludo.tip.yard': 'Nenhum peão está na pista: só um seis tira um peão da base.',
    'helpers.ludo.tip.six': 'Um seis: depois desta jogada você joga de novo.',
    'helpers.ludo.tip.threeSixes': 'Três seis seguidos encerram a vez, e o terceiro não é jogado.',
    'helpers.ludo.tip.star': 'As estrelas são seguras: cair numa não manda ninguém de volta para a base. Só um peão saindo na própria casa de saída manda.',
    'helpers.ludo.tip.blocked': 'Dois peões da mesma cor formam uma barreira: nenhuma outra cor pode cair nela nem passar, e um terceiro peão não pode entrar.',
    'helpers.ludo.tip.blockedTeams': 'Dois peões do mesmo time formam uma barreira, parceiro incluído: nenhum adversário pode cair nela nem passar, e um terceiro peão não pode entrar.',
    'helpers.ludo.tip.partner': 'Parceiros nunca mandam um ao outro de volta para a base: cair no seu parceiro forma uma barreira.',
    'helpers.ludo.tip.helping': 'Seus quatro peões chegaram, então agora cada jogada sua move os peões do seu parceiro. Um seis ainda dá outra jogada.',
    'helpers.ludo.tip.start': 'A casa de saída aceita um peão da própria cor por vez: avance esse antes de tirar outro.',
    'helpers.ludo.tip.exact': 'Para chegar é preciso o número exato, então um peão perto demais para esta jogada fica onde está.'
};
