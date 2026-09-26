import { pickTier, type Choice } from './quality/tiers.ts';

const SLOW_NETWORKS = ['slow-2g', '2g', '3g'];

export interface Conditions
{
    reducedMotion: boolean;

    saveData: boolean;

    effectiveType: string;

    memory: number;
}

export interface Opened
{
    context: WebGL2RenderingContext;

    choice: Choice;
}

export function refused(conditions: Conditions): boolean
{
    return conditions.reducedMotion
        || conditions.saveData
        || SLOW_NETWORKS.includes(conditions.effectiveType)
        || (conditions.memory > 0 && conditions.memory <= 2);
}

export function openWorld(canvas: HTMLCanvasElement): Opened | null
{
    const device = navigator as Navigator & {
        connection?: { saveData?: boolean; effectiveType?: string };
        deviceMemory?: number;
    };
    const memory = device.deviceMemory ?? 0;

    if (refused({
        reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
        saveData: device.connection?.saveData === true,
        effectiveType: device.connection?.effectiveType ?? '',
        memory
    }))
    {
        return null;
    }

    const choice = pickTier({
        cores: navigator.hardwareConcurrency ?? 0,
        memory,
        width: window.innerWidth,
        height: window.innerHeight
    });

    try
    {
        const context = canvas.getContext('webgl2', {
            alpha: false,
            antialias: choice.tier !== 'low',
            depth: true,
            stencil: false,
            powerPreference: 'high-performance',
            failIfMajorPerformanceCaveat: true,
            preserveDrawingBuffer: false
        });
        return context === null ? null : { context, choice };
    }
    catch
    {
        return null;
    }
}
