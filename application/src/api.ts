import { createClient, readManifest, type Manifest } from '@azerothjs/http/api/shared';

import type { Api } from '../../server/src/api.ts';

export type { Account, AchievementDefinition, Challenge, GameSummary, ServerInfo, SessionState } from '../../server/src/schemas.ts';

export { ApiError, applyFieldErrors } from '@azerothjs/http/api/shared';

async function loadManifest(): Promise<Manifest>
{
    if (typeof document === 'undefined')
    {
        return {};
    }
    const embedded = readManifest();
    if (embedded !== undefined)
    {
        return embedded;
    }
    try
    {
        const response = await fetch('/api/_manifest');
        return response.ok ? await response.json() as Manifest : {};
    }
    catch
    {
        return {};
    }
}

export const client = createClient<Api>(await loadManifest(), { baseUrl: '/api' });
