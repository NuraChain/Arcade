import { AnimationMixer, LoopOnce, type AnimationAction, type AnimationClip, type Object3D } from 'three';

import { SHOTS } from './camera/shots.ts';

export const SETTLES: Readonly<Record<string, string>> = {
    together: 'settle-ludo',
    compete: 'settle-backgammon',
    finale: 'settle-poker'
};

export const REACH = 0.35;

export const LONGEST_STEP = 0.05;

export interface Settling
{
    reach(beat: string): boolean;
    look(camera: { x: number; y: number; z: number }): boolean;
    update(seconds: number): boolean;
    dispose(): void;
}

interface Waiting
{
    actions: AnimationAction[];
    nodes: Object3D[];
}

export function createSettling(root: Object3D, clips: readonly AnimationClip[]): Settling
{
    const mixer = new AnimationMixer(root);
    const waiting = new Map<string, Waiting>();
    const playing = new Set<Waiting>();

    for (const [beat, prefix] of Object.entries(SETTLES))
    {
        const own = clips.filter((clip) => clip.name.startsWith(prefix));
        const nodes = [...new Set(own.flatMap((clip) => clip.tracks.map((track) => track.name.split('.')[0])))]
            .map((name) => root.getObjectByName(name))
            .filter((node): node is Object3D => node !== undefined);

        if (own.length === 0 || nodes.length === 0)
        {
            continue;
        }

        for (const node of nodes)
        {
            node.visible = false;
            node.matrixAutoUpdate = true;
            node.traverse((part) => part.matrixWorldAutoUpdate = true);
        }

        waiting.set(beat, {
            nodes,
            actions: own.map((clip) =>
            {
                const action = mixer.clipAction(clip);
                action.setLoop(LoopOnce, 1);
                action.clampWhenFinished = true;
                return action;
            })
        });
    }

    const settling: Settling = {
        reach(beat)
        {
            const entry = waiting.get(beat);

            if (entry === undefined)
            {
                return false;
            }

            waiting.delete(beat);

            for (const node of entry.nodes)
            {
                node.visible = true;
            }
            for (const action of entry.actions)
            {
                action.reset().play();
            }

            playing.add(entry);
            return true;
        },

        look(camera)
        {
            let started = false;

            for (const beat of [...waiting.keys()])
            {
                const [x, y, z] = SHOTS[beat]?.position ?? [Infinity, Infinity, Infinity];

                if (Math.hypot(camera.x - x, camera.y - y, camera.z - z) <= REACH)
                {
                    started = settling.reach(beat) || started;
                }
            }

            return started;
        },

        update(seconds)
        {
            if (playing.size === 0)
            {
                return false;
            }

            mixer.update(Math.min(seconds, LONGEST_STEP));

            for (const entry of [...playing])
            {
                for (const node of entry.nodes)
                {
                    node.updateMatrixWorld(true);
                }

                if (entry.actions.every((action) => !action.isRunning()))
                {
                    playing.delete(entry);
                }
            }

            return playing.size > 0;
        },

        dispose()
        {
            mixer.stopAllAction();
            mixer.uncacheRoot(root);
        }
    };

    return settling;
}
