import type { GameId } from '../data/games.ts';

/** The beds a table can play behind its game, each a file of its own that is fetched only when it plays: a piece
 *  of music for every game, rain and birds. */
export const BEDS = {
    ludo: new URL('./sound/beds/ludo.bed', import.meta.url).href,
    hokm: new URL('./sound/beds/hokm.bed', import.meta.url).href,
    backgammon: new URL('./sound/beds/backgammon.bed', import.meta.url).href,
    poker: new URL('./sound/beds/poker.bed', import.meta.url).href,
    chess: new URL('./sound/beds/chess.bed', import.meta.url).href,
    rain: new URL('./sound/beds/rain.bed', import.meta.url).href,
    birds: new URL('./sound/beds/birds.bed', import.meta.url).href
} as const satisfies Record<GameId | 'rain' | 'birds', string>;
