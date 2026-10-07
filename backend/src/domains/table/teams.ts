export const PARTNERS = ['none', 'optional', 'required'] as const;

export type Partners = typeof PARTNERS[number];

export const teamsOf = (partners: Partners, seats: number, asked: boolean) =>
    seats === 4 && (partners === 'required' || (partners === 'optional' && asked));

export const guestChairs = (seats: number, teams: boolean) =>
    (teams ? [2, 1, 3] : Array.from({ length: seats - 1 }, (_, at) => at + 1));
