import { createClient, readManifest, type Manifest } from '@azerothjs/http/api/shared';

import type { Api } from '../../backend/src/api.ts';

export type {
    Account,
    AdminVault,
    AchievementFamily,
    AchievementLadder,
    AchievementRarity,
    AchievementSummary,
    AchievementTier,
    Attestation,
    Challenge,
    ChainCall,
    ChainFace,
    ChainPerson,
    ChainProfile,
    ChainProfileState,
    ChatMessage,
    ConversationDevices,
    ConversationSigners,
    Device,
    DeviceList,
    ArchiveList,
    EpochState,
    EarnedAchievement,
    GameSummary,
    LiveCounts,
    PlayerRecord,
    GroupPrivacy,
    GroupRole,
    GroupSummary,
    LeaderboardWindow,
    Standing,
    MatchHistory,
    MatchHistoryEntry,
    MatchPlay,
    MatchProof,
    MatchView,
    MatchWatch,
    WatchableTables,
    MuteSubject,
    NftItem,
    NftPage,
    Notification,
    NotificationKind,
    PartyInvite,
    PartyState,
    PartyView,
    PeerDevice,
    PeerSigner,
    PersonRecord,
    PersonSummary,
    PersonView,
    Privacy,
    Progress,
    RecoveryState,
    ServerInfo,
    SessionState,
    SiteNotice,
    SocialGraph,
    TableSeat,
    TableStatus,
    TableSummary,
    TableMoney,
    StakeTerms,
    VaultGame,
    VaultGames,
    VaultState,
    WalletCall
} from '../../backend/src/schemas.ts';

export type {
    ClientFrame,
    PresenceEntry,
    PresenceState,
    ServerFrame
} from '../../backend/src/realtime/frames.ts';

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

export const REQUEST_MS = 15_000;

const refusals = new Set<() => void>();

export function onUnauthorized(listener: () => void)
{
    refusals.add(listener);

    return () =>
    {
        refusals.delete(listener);
    };
}

const heard = async (request: Request) =>
{
    const response = await (typeof AbortSignal.any === 'function'
        ? fetch(request, { signal: AbortSignal.any([request.signal, AbortSignal.timeout(REQUEST_MS)]) })
        : fetch(request));

    if (response.status === 401)
    {
        for (const listener of [...refusals])
        {
            listener();
        }
    }

    return response;
};

export const client = createClient<Api>(await loadManifest(), {
    baseUrl: '/api',
    ...(typeof window !== 'undefined' ? { fetch: heard } : {})
});
