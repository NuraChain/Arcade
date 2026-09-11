import type { Color, Object3D } from 'three';
import {
    AdditiveBlending,
    CircleGeometry,
    Group,
    Mesh,
    MeshBasicMaterial,
    Sprite,
    SpriteMaterial,
    type Texture
} from 'three';

export interface Lamp
{
    root: Object3D;

    setFocus(on: boolean): void;

    setColour(colour: Color): void;

    update(time: number, deltaMs: number): void;

    level(): number;

    lightHeight: number;

    poolRadius: number;

    gain: number;

    dispose(): void;
}

export interface LampOptions
{

    fitting: Object3D;

    height: number;

    poolRadius: number;

    tableTop: number;

    colour: Color;
    poolTexture: Texture;
    glowTexture: Texture;

    phase: number;

    intensity?: number;
}

const FOCUS_RATE = 0.12;

export function createLamp(options: LampOptions): Lamp
{
    const root = new Group();
    const gain = options.intensity ?? 1;

    const fitting = options.fitting.clone(true);
    fitting.position.y = options.height;
    fitting.traverse((node) =>
    {
        node.castShadow = false;
    });
    root.add(fitting);

    const pool = new Mesh(
        new CircleGeometry(options.poolRadius, 24),
        new MeshBasicMaterial({
            map: options.poolTexture,
            color: options.colour,
            transparent: true,
            blending: AdditiveBlending,
            depthWrite: false,
            opacity: 0.34 * gain,
            toneMapped: false
        })
    );
    pool.rotation.x = -Math.PI / 2;
    pool.position.y = options.tableTop + 0.004;
    pool.renderOrder = 2;
    root.add(pool);

    const glow = new Sprite(new SpriteMaterial({
        map: options.glowTexture,
        color: options.colour,
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
        opacity: 0.7 * gain,
        toneMapped: false
    }));
    glow.scale.setScalar(options.poolRadius * 1.5);
    glow.position.y = options.height - 1.5;
    glow.renderOrder = 3;
    root.add(glow);

    let focus = 0;
    let focusTarget = 0;

    const poolMaterial = pool.material as MeshBasicMaterial;
    const glowMaterial = glow.material as SpriteMaterial;

    return {
        root,

        setFocus(on)
        {
            focusTarget = on ? 1 : 0;
        },

        setColour(colour)
        {
            poolMaterial.color.copy(colour);
            glowMaterial.color.copy(colour);
        },

        update(time, deltaMs)
        {
            const rate = 1 - Math.pow(1 - FOCUS_RATE, Math.min(deltaMs, 100) / (1000 / 60));
            focus += (focusTarget - focus) * rate;

            const sway = Math.sin(time * 0.0006 + options.phase) * 0.012;
            fitting.rotation.z = sway;
            fitting.rotation.x = Math.cos(time * 0.0005 + options.phase * 1.7) * 0.008;

            poolMaterial.opacity = (0.34 + focus * 0.26) * gain;
            glowMaterial.opacity = Math.min((0.7 + focus * 0.4) * gain, 1);
        },

        level()
        {
            return focus;
        },

        lightHeight: options.height - 1.45,

        poolRadius: options.poolRadius,

        gain,

        dispose()
        {
            pool.geometry.dispose();
            poolMaterial.dispose();
            glowMaterial.dispose();
        }
    };
}
