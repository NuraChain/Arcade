import {
    Color,
    NeutralToneMapping,
    Scene,
    WebGLRenderer,
    setConsoleFunction
} from 'three';

import { loadShowcase, type Showcase } from './assets/loader.ts';
import type { Beat, WorldCallbacks, WorldHandle } from './bridge.ts';
import { progressAt, type Shot } from './camera/path.ts';
import { createRig } from './camera/rig.ts';
import { FOCUS, SHOTS } from './camera/shots.ts';
import { createGovernor } from './quality/governor.ts';
import { pixelRatioFor, type Choice, type QualityTier } from './quality/tiers.ts';
import { STUDIO, createEnvironment, type Environment } from './render/environment.ts';

export interface WorldOptions
{
    canvas: HTMLCanvasElement;

    context: WebGL2RenderingContext;

    choice: Choice;

    assetBase: string;

    callbacks: WorldCallbacks;
}

let complain: ((message: string) => void) | null = null;

setConsoleFunction((level: string, message: string) =>
{
    if (level === 'error')
    {
        complain?.(message);
    }
});

export async function createWorld(options: WorldOptions): Promise<WorldHandle>
{
    const { canvas, context, callbacks } = options;
    let failed = false;

    const fail = (reason: string): void =>
    {
        if (!failed)
        {
            failed = true;
            callbacks.onFailed?.(reason);
        }
    };
    complain = fail;

    let renderer: WebGLRenderer | null = null;
    let showcase: Showcase | null = null;
    let environment: Environment | null = null;

    const release = (): void =>
    {
        showcase?.dispose();
        environment?.dispose();
        renderer?.dispose();
        if (context.isContextLost())
        {
            canvas.addEventListener('webglcontextrestored', () => context.getExtension('WEBGL_lose_context')?.loseContext(), { once: true });
        }
        else
        {
            context.getExtension('WEBGL_lose_context')?.loseContext();
        }
        if (complain === fail)
        {
            complain = null;
        }
    };

    try
    {
        renderer = new WebGLRenderer({ canvas, context });
        renderer.toneMapping = NeutralToneMapping;
        renderer.toneMappingExposure = STUDIO.exposure;

        const scene = new Scene();
        scene.background = new Color(STUDIO.sky);
        environment = createEnvironment(renderer);
        scene.environment = environment.texture;

        const anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), options.choice.tier === 'low' ? 4 : 8);
        showcase = await loadShowcase(options.assetBase, options.choice.set, anisotropy);
        scene.add(showcase.root);

        return await start(options, renderer, scene, showcase, fail, release);
    }
    catch (error)
    {
        release();
        throw error;
    }
}

async function start(
    options: WorldOptions,
    renderer: WebGLRenderer,
    scene: Scene,
    showcase: Showcase,
    fail: (reason: string) => void,
    release: () => void
): Promise<WorldHandle>
{
    const { canvas, callbacks } = options;
    let tier: QualityTier = options.choice.tier;

    const rig = createRig([{ at: 0, ...SHOTS.arrival }]);
    let arrivals: number[] = [0];
    let scrollY = 0;

    let width = 0;
    let height = 0;

    const size = (): void =>
    {
        width = Math.max(canvas.clientWidth, 1);
        height = Math.max(canvas.clientHeight, 1);
        renderer.setPixelRatio(pixelRatioFor(tier, window.devicePixelRatio || 1, width, height));
        renderer.setSize(width, height, false);
        rig.resize(width, height);
    };
    size();
    rig.snap();

    let frame = 0;
    let running = true;
    let disposed = false;
    let last = 0;

    const governor = createGovernor({
        tier,
        onDowngrade: (next) =>
        {
            tier = next;
            size();
            invalidate();
        },
        onExhausted: () => fail('The device could not keep up')
    });

    const tick = (now: number): void =>
    {
        frame = 0;
        const delta = last === 0 ? 16 : now - last;
        governor.sample(last === 0 ? Infinity : delta);
        last = now;

        const moving = rig.update(delta);
        renderer.render(scene, rig.camera);

        if (moving && running)
        {
            frame = requestAnimationFrame(tick);
        }
        else
        {
            last = 0;
        }
    };

    const invalidate = (): void =>
    {
        if (running && !disposed && frame === 0)
        {
            frame = requestAnimationFrame(tick);
        }
    };

    const lost = (event: Event): void =>
    {
        event.preventDefault();
        fail('The graphics context was lost');
    };
    canvas.addEventListener('webglcontextlost', lost);

    await renderer.compileAsync(scene, rig.camera);
    for (const texture of showcase.textures)
    {
        renderer.initTexture(texture);
    }
    renderer.render(scene, rig.camera);
    callbacks.onReady?.();

    const observer = new ResizeObserver(() =>
    {
        size();
        rig.snap();
        if (running && !disposed)
        {
            renderer.render(scene, rig.camera);
        }
    });
    observer.observe(canvas);

    return {
        measure(beats: readonly Beat[])
        {
            const known = beats.filter((beat) => SHOTS[beat.name] !== undefined);
            const path: Shot[] = known.map((beat, index) => ({
                at: known.length > 1 ? index / (known.length - 1) : 0,
                ...SHOTS[beat.name]
            }));
            arrivals = known.map((beat) => beat.at);
            rig.setPath(path.length > 0 ? path : [{ at: 0, ...SHOTS.arrival }]);
            rig.setProgress(progressAt(scrollY, arrivals));
            invalidate();
        },

        setScroll(y)
        {
            scrollY = y;
            rig.setProgress(progressAt(y, arrivals));
            invalidate();
        },

        setPointer(x, y)
        {
            rig.setPointer(x, y);
            invalidate();
        },

        setFrame(x, y)
        {
            rig.setFrame(x, y);
            rig.snap();
            invalidate();
        },

        focus(id)
        {
            rig.focus(id === null ? null : FOCUS[id]);
            invalidate();
        },

        pause()
        {
            running = false;
            if (frame !== 0)
            {
                cancelAnimationFrame(frame);
                frame = 0;
            }
            last = 0;
        },

        resume()
        {
            running = true;
            invalidate();
        },

        dispose()
        {
            if (disposed)
            {
                return;
            }
            disposed = true;
            cancelAnimationFrame(frame);
            observer.disconnect();
            canvas.removeEventListener('webglcontextlost', lost);
            scene.remove(showcase.root);
            release();
        }
    };
}
