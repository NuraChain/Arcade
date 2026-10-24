import type { Dictionary } from '../en/index.ts';
import type { helpersBackgammon as reference } from '../en/helpers-backgammon.ts';

export const helpersBackgammon: Pick<Dictionary, keyof typeof reference> = {
    'helpers.backgammon.bar': 'Kırık pul önce oyuna girer. O girmeden başka hiçbir pul oynamaz.',
    'helpers.backgammon.doubles': 'Çift zar dört kez oynanır: dört hamle, her biri {die}.',
    'helpers.backgammon.both': 'Oynanabiliyorsa iki zar da oynanmalı; diğer zarı oynanamaz bırakacak bir hamle sunulmaz.',
    'helpers.backgammon.higher': 'Burada yalnızca bir zar oynanabilir ve ikisi de uyuyorsa büyük olan oynanmalı. Oynanacak zar: {die}.',
    'helpers.backgammon.bear': 'Bütün pulların evde, artık toplamaya başlayabilirsin.',
    'helpers.backgammon.double': 'Zar atmadan önce katlayabilirsin: küpe dokun. Rakip ya {cube} değerinden devam eder ya da bu oyunu bırakır.',
    'helpers.backgammon.take': 'Kabul edersen oyun {cube} değerinden sürer. Bırakırsan şimdi biter, değeri: {now}.'
};
