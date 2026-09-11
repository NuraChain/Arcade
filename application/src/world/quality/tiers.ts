export type QualityTier = 'low' | 'medium' | 'high';

export interface QualitySettings
{

    pixelRatio: number;

    shadowMap: number;

    realLights: number;

    dust: number;

    grade: boolean;

    stoolsPerTable: number;

    antialias: boolean;

    atlas: 1024 | 2048;

    anisotropy: number;

    sheen: boolean;

    environment: boolean;
}

export const TIERS: Record<QualityTier, QualitySettings> = {
    low: {
        pixelRatio: 1,
        shadowMap: 0,
        realLights: 1,
        dust: 0,
        grade: false,
        stoolsPerTable: 2,
        antialias: false,
        atlas: 1024,
        anisotropy: 2,
        sheen: false,
        environment: true
    },
    medium: {
        pixelRatio: 1.5,
        shadowMap: 1024,
        realLights: 2,
        dust: 200,
        grade: true,
        stoolsPerTable: 3,
        antialias: true,
        atlas: 2048,
        anisotropy: 4,
        sheen: true,
        environment: true
    },
    high: {
        pixelRatio: 2,
        shadowMap: 2048,
        realLights: 4,
        dust: 600,
        grade: true,
        stoolsPerTable: 4,
        antialias: true,
        atlas: 2048,
        anisotropy: 8,
        sheen: true,
        environment: true
    }
};

export const TIER_ORDER: QualityTier[] = ['low', 'medium', 'high'];

export interface DeviceProfile
{

    webgl: boolean;

    cores: number;

    pixelRatio: number;

    width: number;

    memory: number;

    reducedMotion: boolean;
}

export function pickTier(profile: DeviceProfile): QualityTier
{
    if (profile.width < 720)
    {
        return profile.cores >= 6 && profile.pixelRatio <= 3 ? 'medium' : 'low';
    }

    if (profile.memory > 0 && profile.memory <= 4)
    {
        return 'low';
    }

    if (profile.cores >= 8 && profile.width >= 1280)
    {
        return 'high';
    }

    if (profile.cores >= 4)
    {
        return 'medium';
    }

    return profile.cores === 0 ? 'medium' : 'low';
}

let webglSupport: boolean | null = null;

function probeWebgl(): boolean
{
    try
    {
        const probe = document.createElement('canvas');
        const context = probe.getContext('webgl2');
        if (context === null)
        {
            return false;
        }
        context.getExtension('WEBGL_lose_context')?.loseContext();
        return true;
    }
    catch
    {
        return false;
    }
}

export function readDeviceProfile(): DeviceProfile
{
    if (typeof window === 'undefined' || typeof navigator === 'undefined')
    {
        return { webgl: false, cores: 0, pixelRatio: 1, width: 0, memory: 0, reducedMotion: true };
    }

    webglSupport ??= probeWebgl();
    const webgl = webglSupport;

    const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 0;

    return {
        webgl,
        cores: navigator.hardwareConcurrency ?? 0,
        pixelRatio: window.devicePixelRatio ?? 1,
        width: window.innerWidth,
        memory,
        reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches
    };
}
