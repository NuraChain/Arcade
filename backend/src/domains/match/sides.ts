export type Variant = 'standard' | 'teams';

export interface Format
{
    seats: number;
    variant: Variant;
}

export const variantOf = (teams: boolean): Variant => (teams ? 'teams' : 'standard');

export const sideOf = (seat: number, format: Format) => (format.variant === 'teams' ? seat % 2 : seat);
