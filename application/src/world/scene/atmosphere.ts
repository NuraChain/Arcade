import type { Color } from 'three';
import {
    AdditiveBlending,
    BufferGeometry,
    Float32BufferAttribute,
    Points,
    PointsMaterial,
    type Texture
} from 'three';

export interface Atmosphere
{
    points: Points[];
    update(time: number): void;
    dispose(): void;
}

function seeded(seed: number): () => number
{
    let state = seed;
    return (): number =>
    {
        state = (state * 1664525 + 1013904223) % 4294967296;
        return state / 4294967296;
    };
}

export interface AtmosphereOptions
{
    dustCount: number;
    glowTexture: Texture;
    lampColour: Color;
}

export function createAtmosphere(options: AtmosphereOptions): Atmosphere
{
    const random = seeded(20260910);
    const points: Points[] = [];

    const farCount = 220;
    const farPositions = new Float32Array(farCount * 3);
    for (let index = 0; index < farCount; index += 1)
    {
        const angle = random() * Math.PI * 2;
        const distance = 26 + random() * 70;
        farPositions[index * 3] = Math.cos(angle) * distance;
        farPositions[index * 3 + 1] = -4 + random() * 9;
        farPositions[index * 3 + 2] = Math.sin(angle) * distance - 14;
    }

    const farGeometry = new BufferGeometry();
    farGeometry.setAttribute('position', new Float32BufferAttribute(farPositions, 3));

    const far = new Points(farGeometry, new PointsMaterial({
        map: options.glowTexture,
        color: options.lampColour,
        size: 2.4,
        sizeAttenuation: true,
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
        opacity: 0.55,
        toneMapped: false
    }));
    far.renderOrder = 1;
    far.frustumCulled = false;
    points.push(far);

    let dust: Points | null = null;
    if (options.dustCount > 0)
    {
        const positions = new Float32Array(options.dustCount * 3);
        for (let index = 0; index < options.dustCount; index += 1)
        {
            positions[index * 3] = (random() - 0.5) * 34;
            positions[index * 3 + 1] = random() * 5.5;
            positions[index * 3 + 2] = (random() - 0.5) * 22 - 2;
        }

        const geometry = new BufferGeometry();
        geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));

        dust = new Points(geometry, new PointsMaterial({
            map: options.glowTexture,
            color: options.lampColour,
            size: 0.055,
            sizeAttenuation: true,
            transparent: true,
            blending: AdditiveBlending,
            depthWrite: false,
            opacity: 0.4,
            toneMapped: false
        }));
        dust.renderOrder = 4;
        points.push(dust);
    }

    const drifting = dust;

    return {
        points,

        update(time)
        {
            if (drifting === null)
            {
                return;
            }
            drifting.position.y = Math.sin(time * 0.00013) * 0.5;
            drifting.position.x = Math.sin(time * 0.00008) * 0.9;
            drifting.rotation.y = time * 0.000012;
        },

        dispose()
        {
            for (const cloud of points)
            {
                cloud.geometry.dispose();
                (cloud.material as PointsMaterial).dispose();
            }
        }
    };
}
