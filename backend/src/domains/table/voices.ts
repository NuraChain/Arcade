export const VOICE_SCOPES = ['off', 'table'] as const;

export type VoiceScope = typeof VOICE_SCOPES[number];
