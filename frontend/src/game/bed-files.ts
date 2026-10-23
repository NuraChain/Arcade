/** The beds a table can play behind its game, each a file of its own that is fetched only when it plays. */
export const BEDS = {
    rain: new URL('./sound/beds/rain.bed', import.meta.url).href
} as const;

export type BedKind = keyof typeof BEDS;
