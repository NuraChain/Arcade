import {
    ACESFilmicToneMapping,
    Color,
    DirectionalLight,
    FogExp2,
    HemisphereLight,
    MathUtils,
    PCFShadowMap,
    Raycaster,
    Scene,
    Vector2,
    Vector3,
    WebGLRenderer
} from 'three';

import type { GameId } from '../data/games.ts';
import { loadAssets } from './assets/loader.ts';
import type { WorldCallbacks, WorldHandle } from './bridge.ts';
import { createRig } from './camera/rig.ts';
import { DESKTOP_SHOTS, MOBILE_SHOTS, offsetShots } from './camera/shots.ts';
import { createGovernor } from './quality/governor.ts';
import { TIERS, pickTier, readDeviceProfile, type QualitySettings } from './quality/tiers.ts';
import { createEnvironment } from './render/environment.ts';
import { createMaterials, readWorldScalar, readWorldToken } from './render/materials.ts';
import { createAtmosphere, type Atmosphere } from './scene/atmosphere.ts';
import { createMarket, type Market } from './scene/market.ts';
import { glowTexture, lightPoolTexture } from './scene/textures.ts';

const MOBILE_WIDTH = 640;
const COPY_OFFSET = 0.55;
const KEY_DIRECTION = new Vector3(2.5, 11, 5).normalize();
const MARKET_CENTRE = new Vector3(0, 0.5, 0);

export interface WorldOptions
{
    canvas: HTMLCanvasElement;

    host: HTMLElement;

    assetBase: string;

    reducedMotion: boolean;
    callbacks: WorldCallbacks;
}

/**
 * Builds the world, and releases the GL context if anything on the way out throws.
 *
 * The renderer exists from early in `buildWorld`, and only the asset load was ever guarded - so a
 * throw from the environment, the market, the atmosphere, the rig or the first resize rejected
 * AFTER the context had been created, with no handle returned. `world-canvas` catches that
 * rejection, logs a warning and keeps the static page, so `dispose()` is never called on anything:
 * the context is orphaned with nothing left holding a reference to release it. Repeat that a few
 * times - a flaky asset host, a device that fails on one of these - and it is "Too many active
 * WebGL contexts", which this codebase has already hit twice.
 *
 * Written as a wrapper rather than a `try` around the body, deliberately: the body is a hundred and
 * fifty lines that declare everything the handle closes over, and wrapping it in a block would
 * either re-indent all of it or hoist a dozen bindings out of their scope for a cleanup path.
 * `report` hands the renderer out the moment it exists, which is the only thing the cleanup needs.
 */
export async function createWorld(options: WorldOptions): Promise<WorldHandle>
{
    let made: WebGLRenderer | null = null;

    try
    {
        return await buildWorld(options, (renderer) =>
        {
            made = renderer;
        });
    }
    catch (error)
    {
        const orphan = made as WebGLRenderer | null;

        orphan?.dispose();
        orphan?.forceContextLoss();

        throw error;
    }
}

async function buildWorld(options: WorldOptions, report: (renderer: WebGLRenderer) => void): Promise<WorldHandle>
{
    const profile = readDeviceProfile();

    if (!profile.webgl)
    {
        options.callbacks.onFailed?.('WebGL is unavailable');
        throw new Error('world: no WebGL2');
    }

    let tier = pickTier(profile);
    let settings: QualitySettings = TIERS[tier];

    const renderer = new WebGLRenderer({
        canvas: options.canvas,
        antialias: settings.antialias,
        alpha: false,
        powerPreference: 'high-performance',
        preserveDrawingBuffer: false
    });

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, settings.pixelRatio));
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.92;
    renderer.shadowMap.enabled = settings.shadowMap > 0;
    renderer.shadowMap.type = PCFShadowMap;

    const scene = new Scene();

    const palette = (): {
        sky: Color;
        fog: Color;
        key: Color;
        fill: Color;
        rim: Color;
        lamp: Color;
        stone: Color;
        fogDensity: number;
        lampIntensity: number;
        environmentIntensity: number;
    } => ({
        sky: readWorldToken('sky', '#0A1216'),
        fog: readWorldToken('fog', '#10222A'),
        key: readWorldToken('key', '#FFC46A'),
        fill: readWorldToken('fill', '#2B4E5E'),
        rim: readWorldToken('rim', '#7FB4C9'),
        lamp: readWorldToken('lamp', '#FFB43D'),
        stone: readWorldToken('stone', '#33474F'),
        fogDensity: readWorldScalar('fog-density', 1),
        lampIntensity: readWorldScalar('lamp-intensity', 1),
        environmentIntensity: readWorldScalar('env', 0.35)
    });

    const lit = palette();
    const { sky, fog: fogColour, key: keyColour, fill: fillColour, rim: rimColour, lamp: lampColour, stone: stoneColour } = lit;
    const { fogDensity, lampIntensity, environmentIntensity } = lit;

    scene.background = new Color(sky);
    scene.fog = new FogExp2(fogColour.getHex(), 0.019 * fogDensity);

    const key = new DirectionalLight(keyColour, 1.5 * lampIntensity);
    key.position.copy(MARKET_CENTRE).addScaledVector(KEY_DIRECTION, 12);
    key.target.position.copy(MARKET_CENTRE);
    key.castShadow = settings.shadowMap > 0;
    key.shadow.mapSize.setScalar(Math.max(settings.shadowMap, 1));
    key.shadow.camera.left = -14;
    key.shadow.camera.right = 14;
    key.shadow.camera.top = 10.5;
    key.shadow.camera.bottom = -10.5;
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 30;
    key.shadow.bias = -0.0012;
    key.shadow.normalBias = 0.02;
    scene.add(key);
    scene.add(key.target);

    const fill = new HemisphereLight(rimColour, fillColour, 0.42);
    scene.add(fill);

    const rim = new DirectionalLight(rimColour, 0.35);
    rim.position.set(-6, 4, -14);
    scene.add(rim);

    report(renderer);

    const materials = createMaterials(settings);
    const abort = new AbortController();

    let assets;
    try
    {
        assets = await loadAssets(options.assetBase, materials, settings, abort.signal);
    }
    catch (error)
    {
        materials.dispose();
        renderer.dispose();
        renderer.forceContextLoss();
        if ((error as Error).name !== 'AbortError')
        {
            options.callbacks.onFailed?.('The market could not be loaded');
        }
        throw error;
    }

    renderer.initTexture(assets.atlas);

    const environment = settings.environment
        ? createEnvironment(renderer, { sky, lamp: lampColour, fill: fillColour, rim: rimColour })
        : null;
    if (environment !== null)
    {
        scene.environment = environment.texture;
        scene.environmentIntensity = environmentIntensity;
    }

    const poolTexture = lightPoolTexture();
    const glow = glowTexture();

    const market: Market = createMarket({
        assets,
        materials,
        settings,
        lampColour,
        stoneColour,
        poolTexture,
        glowTexture: glow
    });
    scene.add(market.root);
    market.applyTier(settings);

    const atmosphere: Atmosphere = createAtmosphere({
        dustCount: settings.dust,
        glowTexture: glow,
        lampColour
    });
    for (const cloud of atmosphere.points)
    {
        scene.add(cloud);
    }

    const bounds = options.host.getBoundingClientRect();
    const mobile = bounds.width < MOBILE_WIDTH;
    let side = -1;
    let narrow = mobile;

    const shotsFor = (): typeof DESKTOP_SHOTS =>
        narrow ? MOBILE_SHOTS : offsetShots(DESKTOP_SHOTS, side * COPY_OFFSET);

    const rig = createRig(shotsFor(), bounds.width / Math.max(bounds.height, 1));
    rig.setReducedMotion(options.reducedMotion);

    const raycaster = new Raycaster();
    const pointerNdc = new Vector2();
    let hovered: GameId | null = null;
    let pickQueued = false;

    const pick = (): void =>
    {
        pickQueued = false;
        raycaster.setFromCamera(pointerNdc, rig.camera);
        const hits = raycaster.intersectObjects(market.proxies, false);
        const next = hits.length > 0 ? (hits[0].object.userData.gameId as GameId) : null;

        if (next !== hovered)
        {
            hovered = next;
            market.setFocus(next);
            options.callbacks.onHover?.(next);
        }
    };

    const resize = (): void =>
    {
        const rect = options.host.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0)
        {
            return;
        }
        renderer.setSize(rect.width, rect.height, false);
        rig.resize(rect.width, rect.height);
        narrow = rect.width < MOBILE_WIDTH;
        rig.setShots(shotsFor());
    };

    const observer = new ResizeObserver(resize);
    observer.observe(options.host);
    resize();

    const governor = createGovernor({
        tier,
        onDowngrade: (next) =>
        {
            tier = next;
            settings = TIERS[next];
            renderer.setPixelRatio(Math.min(window.devicePixelRatio, settings.pixelRatio));
            renderer.shadowMap.enabled = settings.shadowMap > 0;
            key.castShadow = settings.shadowMap > 0;
            market.applyTier(settings);
            options.callbacks.onTierChange?.(next);
        }
    });

    const followTarget = new Vector3();

    const followShadow = (): void =>
    {
        const progress = rig.progress();
        const blend = MathUtils.smoothstep(progress, 0.38, 0.44) * (1 - MathUtils.smoothstep(progress, 0.78, 0.84));
        followTarget.copy(MARKET_CENTRE).lerp(rig.target, blend);
        key.target.position.copy(followTarget);
        key.position.copy(followTarget).addScaledVector(KEY_DIRECTION, 12);
        const half = 14 - 11 * blend;
        key.shadow.camera.left = -half;
        key.shadow.camera.right = half;
        key.shadow.camera.top = half * 0.75;
        key.shadow.camera.bottom = -half * 0.75;
        key.shadow.camera.updateProjectionMatrix();
        key.shadow.bias = -0.0012 + 0.0008 * blend;
        key.shadow.normalBias = 0.02 - 0.015 * blend;
        key.target.updateMatrixWorld();
    };

    let frame = 0;

    /**
     * Whether the loop is drawing, and whether it is SCHEDULED at all.
     *
     * `pause()` used to set this false and nothing else, so the callback went on waking sixty times
     * a second to reach the guard below and return - for a canvas that is off screen, behind the
     * signed-in half of the site, or in a background tab. The browser keeps the compositor and this
     * closure alive for it, and on a laptop that is the difference between an idle page and one
     * that costs battery for nothing. Cancelling the frame is what makes the pause a pause.
     *
     * The guard inside `tick` stays as a belt: a frame already in flight when `pause` runs must not
     * render against state that is about to be disposed.
     */
    let running = true;
    let last = performance.now();
    let announced = false;

    const tick = (now: number): void =>
    {
        frame = requestAnimationFrame(tick);
        const delta = now - last;
        last = now;

        if (!running)
        {
            return;
        }

        governor.sample(delta);

        if (pickQueued)
        {
            pick();
        }

        rig.update(now, delta);
        market.update(now, delta, rig.target);
        atmosphere.update(now);
        if (key.castShadow)
        {
            followShadow();
        }

        renderer.render(scene, rig.camera);

        if (!announced)
        {
            announced = true;
            options.callbacks.onReady?.();
        }
    };

    frame = requestAnimationFrame(tick);

    return {
        setProgress(value)
        {
            rig.setProgress(value);
        },

        setPointer(x, y)
        {
            pointerNdc.set(x, y);
            rig.setPointer(x, y);
            pickQueued = true;
        },

        focusTable(id)
        {
            hovered = id;
            market.setFocus(id);
        },

        setReducedMotion(on)
        {
            rig.setReducedMotion(on);
        },

        setDirection(direction)
        {
            side = direction === 'rtl' ? 1 : -1;
            rig.setShots(shotsFor());
        },

        relight()
        {
            const next = palette();
            (scene.background as Color).set(next.sky);
            (scene.fog as FogExp2).color.set(next.fog);
            (scene.fog as FogExp2).density = 0.019 * next.fogDensity;
            key.color.set(next.key);
            key.intensity = 1.5 * next.lampIntensity;
            fill.color.set(next.rim);
            fill.groundColor.set(next.fill);
            rim.color.set(next.rim);
            scene.environmentIntensity = next.environmentIntensity;
            market.relight(next.lamp, next.stone);
        },

        pause()
        {
            if (!running)
            {
                return;
            }

            running = false;
            cancelAnimationFrame(frame);
            frame = 0;
        },

        resume()
        {
            if (running)
            {
                return;
            }

            last = performance.now();
            running = true;
            frame = requestAnimationFrame(tick);
        },

        dispose()
        {
            cancelAnimationFrame(frame);
            abort.abort();
            observer.disconnect();

            scene.remove(market.root);
            market.dispose();
            atmosphere.dispose();
            assets.dispose();
            materials.dispose();
            poolTexture.dispose();
            glow.dispose();
            environment?.dispose();

            key.dispose();
            rim.dispose();
            fill.dispose();

            renderer.dispose();
            renderer.forceContextLoss();
        }
    };
}
