import type { Dictionary } from '../en/index.ts';
import type { helpersBackgammon as reference } from '../en/helpers-backgammon.ts';

export const helpersBackgammon: Pick<Dictionary, keyof typeof reference> = {
    'helpers.backgammon.bar': 'Uma pedra na barra volta primeiro. Nada mais se mexe até ela entrar.',
    'helpers.backgammon.doubles': 'Dados iguais valem quatro vezes: quatro movimentos de {die}.',
    'helpers.backgammon.both': 'Os dois dados têm que ser jogados quando dá, então um movimento que deixaria o outro dado sem saída não aparece.',
    'helpers.backgammon.higher': 'Só um dado pode ser jogado aqui, e quando qualquer um serve tem que ser o maior: o {die}.',
    'helpers.backgammon.bear': 'Todas as suas pedras estão em casa, então você já pode começar a tirá-las.',
    'helpers.backgammon.double': 'Antes de rolar você pode dobrar: toque no dado de dobra. Aí o outro lado continua valendo {cube} ou desiste desta partida.',
    'helpers.backgammon.take': 'Aceite e a partida continua valendo {cube}. Desista e ela acaba agora, valendo {now}.'
};
