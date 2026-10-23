import { AnimationMixer, LoopOnce, type AnimationAction, type AnimationClip, type Object3D } from 'three';

import { FOCUS } from './camera/shots.ts';
import { GAMES, type GameId } from '../data/games.ts';

export const SETTLES: Readonly<Partial<Record<GameId, string>>> = {
    ludo: 'settle-ludo',
    backgammon: 'settle-backgammon',
    poker: 'settle-poker',
    chess: 'settle-chess'
};

export const REACH = 0.35;

export const LONGEST_STEP = 0.05;

export interface Settling
{
    reach(game: GameId): boolean;
    look(camera: { x: number; y: number; z: number }): boolean;
    update(seconds: number): boolean;
    dispose(): void;
}

interface Waiting
{
    actions: AnimationAction[];
    nodes: Object3D[];
}

export function createSettling(root: Object3D, clips: readonly AnimationClip[])
{
    const mixer = new AnimationMixer(root);
    const waiting = new Map<GameId, Waiting>();
    const playing = new Set<Waiting>();

    for (const { id: game } of GAMES)
    {
        const prefix = SETTLES[game];

        if (prefix === undefined)
        {
            continue;
        }

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

        waiting.set(game, {
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
        reach(game)
        {
            const entry = waiting.get(game);

            if (entry === undefined)
            {
                return false;
            }

            waiting.delete(game);

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

            for (const game of [...waiting.keys()])
            {
                const [x, y, z] = FOCUS[game].position;

                if (Math.hypot(camera.x - x, camera.y - y, camera.z - z) <= REACH)
                {
                    started = settling.reach(game) || started;
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
