import type { Shot } from './path.ts';

export const DESKTOP_SHOTS: Shot[] = [
    { at: 0.00, position: [0.5, 9.4, 18.0], target: [0, 1.4, 1.0], fov: 40 },
    { at: 0.10, position: [1.4, 6.2, 13.6], target: [0, 1.2, 2.0], fov: 39 },

    { at: 0.20, position: [2.2, 2.9, 10.6], target: [0, 1.0, 4.0], fov: 38 },

    { at: 0.28, position: [-3.2, 1.35, 8.2], target: [0, 0.95, 4.0], fov: 36 },
    { at: 0.35, position: [-6.2, 1.5, 6.0], target: [-1.6, 0.9, 2.0], fov: 36 },

    { at: 0.42, position: [-9.2, 3.29, -1.1], target: [-9.5, 1.69, -3.4], fov: 34 },
    { at: 0.48, position: [-3.1, 1.91, 0.5], target: [-3.4, 0.31, -1.8], fov: 34 },
    { at: 0.54, position: [3.65, 2.77, -0.52], target: [3.4, 1.47, -2.4], fov: 34 },
    { at: 0.60, position: [9.11, 1.77, -2.36], target: [9.6, 0.47, -4.2], fov: 34 },

    { at: 0.72, position: [4.82, 2.42, -2.68], target: [3.3, 1.57, -2.38], fov: 28 },

    { at: 0.86, position: [2.4, 4.6, -6.5], target: [0, 5.2, -15.0], fov: 40 },

    { at: 0.95, position: [0, 8.0, 4.0], target: [0, 1.5, -3.0], fov: 44 },
    { at: 1.00, position: [0, 12.0, 19.0], target: [0, 1.0, -2.0], fov: 46 }
];

export const MOBILE_SHOTS: Shot[] = [
    { at: 0.00, position: [0, 11.0, 18.0], target: [0, 1.2, 2.0], fov: 54 },
    { at: 0.10, position: [0.8, 6.0, 12.5], target: [0, 1.0, 2.5], fov: 52 },
    { at: 0.20, position: [1.2, 2.8, 8.4], target: [0, 1.0, 4.0], fov: 50 },
    { at: 0.28, position: [-1.8, 1.5, 7.4], target: [0, 0.95, 4.0], fov: 48 },
    { at: 0.35, position: [-3.6, 1.9, 5.4], target: [-1.4, 0.9, 2.0], fov: 48 },

    { at: 0.42, position: [-9.3, 3.5, -1.5], target: [-9.5, 1.69, -3.4], fov: 50 },
    { at: 0.48, position: [-3.2, 2.1, 0.1], target: [-3.4, 0.31, -1.8], fov: 50 },
    { at: 0.54, position: [3.6, 2.9, -0.8], target: [3.4, 1.47, -2.4], fov: 50 },
    { at: 0.60, position: [9.2, 1.95, -2.7], target: [9.6, 0.47, -4.2], fov: 50 },

    { at: 0.72, position: [4.7, 2.5, -2.66], target: [3.3, 1.57, -2.38], fov: 42 },
    { at: 0.86, position: [1.8, 4.8, -7.0], target: [0, 5.2, -15.0], fov: 52 },
    { at: 0.95, position: [0, 7.0, 2.5], target: [0, 1.5, -3.0], fov: 56 },
    { at: 1.00, position: [0, 10.0, 14.0], target: [0, 1.0, -2.0], fov: 58 }
];

export const SCENE_MARKS: Array<{ id: string; at: number }> = [
    { id: 'arrival', at: 0.00 },
    { id: 'hub', at: 0.20 },
    { id: 'people', at: 0.28 },
    { id: 'games', at: 0.42 },
    { id: 'crew', at: 0.72 },
    { id: 'compete', at: 0.86 },
    { id: 'finale', at: 0.95 }
];

export const TABLE_BEATS: readonly [number, number] = [0.42, 0.60];

export function offsetShots(shots: Shot[], lateral: number): Shot[]
{
    if (lateral === 0)
    {
        return shots;
    }

    return shots.map((shot) =>
    {
        if (shot.at < TABLE_BEATS[0] - 0.001 || shot.at > TABLE_BEATS[1] + 0.001)
        {
            return shot;
        }

        const fx = shot.target[0] - shot.position[0];
        const fz = shot.target[2] - shot.position[2];
        const length = Math.hypot(fx, fz) || 1;
        const rx = -fz / length;
        const rz = fx / length;

        return {
            at: shot.at,
            fov: shot.fov,
            position: [shot.position[0] + rx * lateral, shot.position[1], shot.position[2] + rz * lateral],
            target: [shot.target[0] + rx * lateral, shot.target[1], shot.target[2] + rz * lateral]
        };
    });
}
