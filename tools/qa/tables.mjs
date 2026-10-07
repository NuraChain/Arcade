const TABLE_DEFAULTS = Object.freeze({
    game: 'ludo',
    seats: 2,
    mode: 'turns',
    privacy: 'public',
    target: 0,
    cube: false,
    blinds: 'low',
    chat: true,
    voice: 'off',
    teams: false,
    invitees: Object.freeze([])
});

export const tableBody = (wanted) => ({ ...TABLE_DEFAULTS, ...wanted });
