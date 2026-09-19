import { createClient, readManifest, type Manifest } from '@azerothjs/http/api/shared';

import type { Api } from '../../server/src/api.ts';

export type {
    Account,
    AchievementDefinition,
    Attestation,
    Challenge,
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
    MatchView,
    MatchWatch,
    WatchableTables,
    MuteSubject,
    Notification,
    NotificationKind,
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
    SocialGraph,
    TableSeat,
    TableStatus,
    TableSummary
} from '../../server/src/schemas.ts';

export type {
    ClientFrame,
    PresenceEntry,
    PresenceState,
    ServerFrame
} from '../../server/src/realtime/frames.ts';

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
