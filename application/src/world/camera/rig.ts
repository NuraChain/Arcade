import { PerspectiveCamera, Vector3 } from 'three';

import { damping, sampleShots, type Shot } from './path.ts';

const POSITION_RATE = 0.075;
const TARGET_RATE = 0.09;
const FOV_RATE = 0.06;

const PARALLAX = 0.42;
const PARALLAX_RATE = 0.05;

const DRIFT = 0.05;

export interface Rig
{
    camera: PerspectiveCamera;
    target: Vector3;
    progress(): number;
    setProgress(value: number): void;
    setPointer(x: number, y: number): void;
    setShots(shots: Shot[]): void;
    setReducedMotion(on: boolean): void;
    resize(width: number, height: number): void;
    update(time: number, deltaMs: number): void;
}

export function createRig(shots: Shot[], aspect: number): Rig
{
    const camera = new PerspectiveCamera(40, aspect, 0.1, 220);

    let path = shots;
    let progress = 0;
    let reduced = false;

    const position = new Vector3();
    const target = new Vector3();
    let fov = 40;

    const pointer = { x: 0, y: 0 };
    const smoothedPointer = { x: 0, y: 0 };

    const desiredPosition = new Vector3();
    const desiredTarget = new Vector3();
    const offset = new Vector3();
    const forward = new Vector3();
    const right = new Vector3();
    const up = new Vector3(0, 1, 0);

    const first = sampleShots(path, 0);
    position.set(...first.position);
    target.set(...first.target);
    fov = first.fov;
    camera.position.copy(position);
    camera.lookAt(target);
    camera.fov = fov;
    camera.updateProjectionMatrix();

    return {
        camera,
        target,

        progress()
        {
            return progress;
        },

        setProgress(value)
        {
            progress = value;
        },

        setPointer(x, y)
        {
            pointer.x = x;
            pointer.y = y;
        },

        setShots(next)
        {
            path = next;
        },

        setReducedMotion(on)
        {
            reduced = on;
            if (on)
            {
                smoothedPointer.x = 0;
                smoothedPointer.y = 0;
            }
        },

        resize(width, height)
        {
            camera.aspect = width / Math.max(height, 1);
            camera.updateProjectionMatrix();
        },

        update(time, deltaMs)
        {
            const frame = sampleShots(path, progress);
            desiredPosition.set(...frame.position);
            desiredTarget.set(...frame.target);

            if (reduced)
            {
                position.copy(desiredPosition);
                target.copy(desiredTarget);
                fov = frame.fov;
            }
            else
            {
                position.lerp(desiredPosition, damping(POSITION_RATE, deltaMs));
                target.lerp(desiredTarget, damping(TARGET_RATE, deltaMs));
                fov += (frame.fov - fov) * damping(FOV_RATE, deltaMs);

                const settle = damping(PARALLAX_RATE, deltaMs);
                smoothedPointer.x += (pointer.x - smoothedPointer.x) * settle;
                smoothedPointer.y += (pointer.y - smoothedPointer.y) * settle;
            }

            offset.set(0, 0, 0);

            if (!reduced)
            {
                forward.subVectors(desiredTarget, desiredPosition).normalize();
                right.crossVectors(forward, up).normalize();

                offset.addScaledVector(right, smoothedPointer.x * PARALLAX);
                offset.addScaledVector(up, -smoothedPointer.y * PARALLAX);

                offset.x += Math.sin(time * 0.00021) * DRIFT;
                offset.y += Math.sin(time * 0.00013 + 1.7) * DRIFT * 0.6;
            }

            camera.position.copy(position).add(offset);
            camera.lookAt(target);

            if (Math.abs(camera.fov - fov) > 0.01)
            {
                camera.fov = fov;
                camera.updateProjectionMatrix();
            }
        }
    };
}
