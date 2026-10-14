export const VOICE_SCOPES = ['off', 'table', 'team'] as const;

export type VoiceScope = typeof VOICE_SCOPES[number];

export const scopeFor = (preference: VoiceScope, teams: boolean) => (preference === 'team' && !teams ? 'table' : preference);

export const callOf = (scope: VoiceScope, tableId: string, side: number) =>
{
    if (scope === 'off')
    {
        return null;
    }

    return scope === 'team' ? `${ tableId }#${ side }` : tableId;
}
