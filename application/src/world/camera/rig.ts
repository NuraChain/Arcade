import { PerspectiveCamera, Vector3 } from 'three';

import { damping, lens, sampleShots, type Frame, type Shot } from './path.ts';

const POSITION_RATE = 0.1;
const TARGET_RATE = 0.12;
const FOV_RATE = 0.1;
const POINTER_RATE = 0.08;

const PARALLAX = 0.03;

const SETTLED = 0.0004;

const UP = new Vector3(0, 1, 0);

export interface Rig
{
    camera: PerspectiveCamera;

    setPath(shots: Shot[]): void;

    setProgress(value: number): void;

    setPointer(x: number, y: number): void;

    focus(frame: Frame | null): void;

    setFrame(subjectX: number, subjectY: number): void;

    resize(width: number, height: number): void;

    snap(): void;

    update(deltaMs: number): boolean;
}

export function createRig(shots: Shot[]): Rig
{
    const camera = new PerspectiveCamera(30, 1, 0.05, 60);

    let path = shots;
    let progress = 0;
    let focused: Frame | null = null;

    let width = 1;
    let height = 1;
    let subjectX = 0.5;
    let subjectY = 0.5;

    const position = new Vector3();
    const target = new Vector3();
    let fov = 30;

    const desiredPosition = new Vector3();
    const desiredTarget = new Vector3();
    let desiredFov = 30;

    const pointer = { x: 0, y: 0 };
    const smoothed = { x: 0, y: 0 };

    const forward = new Vector3();
    const right = new Vector3();
    const lift = new Vector3();

    const desire = (): void =>
    {
        const frame = focused ?? sampleShots(path, progress);
        desiredPosition.set(...frame.position);
        desiredTarget.set(...frame.target);
        desiredFov = frame.fov;
    };

    const apply = (): void =>
    {
        forward.subVectors(target, position).normalize();
        right.crossVectors(forward, UP).normalize();
        lift.crossVectors(right, forward).normalize();

        camera.position.copy(position)
            .addScaledVector(right, smoothed.x * PARALLAX)
            .addScaledVector(lift, smoothed.y * PARALLAX);
        camera.lookAt(target);

        const view = lens(fov, width / height, subjectX, subjectY);
        camera.fov = view.fov;
        camera.aspect = width / height;
        camera.setViewOffset(width, height, view.x * width, view.y * height, width, height);
        camera.updateProjectionMatrix();
    };

    const rig: Rig = {
        camera,

        setPath(next)
        {
            path = next;
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

        focus(frame)
        {
            focused = frame;
        },

        setFrame(x, y)
        {
            subjectX = x;
            subjectY = y;
        },

        resize(nextWidth, nextHeight)
        {
            width = Math.max(nextWidth, 1);
            height = Math.max(nextHeight, 1);
        },

        snap()
        {
            desire();
            position.copy(desiredPosition);
            target.copy(desiredTarget);
            fov = desiredFov;
            smoothed.x = pointer.x;
            smoothed.y = pointer.y;
            apply();
        },

        update(deltaMs)
        {
            desire();

            position.lerp(desiredPosition, damping(POSITION_RATE, deltaMs));
            target.lerp(desiredTarget, damping(TARGET_RATE, deltaMs));
            fov += (desiredFov - fov) * damping(FOV_RATE, deltaMs);

            const settle = damping(POINTER_RATE, deltaMs);
            smoothed.x += (pointer.x - smoothed.x) * settle;
            smoothed.y += (pointer.y - smoothed.y) * settle;

            apply();

            return position.distanceTo(desiredPosition) > SETTLED
                || target.distanceTo(desiredTarget) > SETTLED
                || Math.abs(desiredFov - fov) > 0.01
                || Math.abs(pointer.x - smoothed.x) > 0.002
                || Math.abs(pointer.y - smoothed.y) > 0.002;
        }
    };

    rig.snap();
    return rig;
}
