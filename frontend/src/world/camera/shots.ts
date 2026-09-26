import { GAMES, type GameId } from '../../data/games.ts';
import type { Frame, Vec3 } from './path.ts';

const SUBJECT_HEIGHT = 0.15;

function anchorOf(id: GameId): Vec3
{
    return GAMES.find((game) => game.id === id)!.anchor;
}

function around(id: GameId, azimuth: number, elevation: number, distance: number, fov: number): Frame
{
    const [x, y, z] = anchorOf(id);
    const turn = (azimuth * Math.PI) / 180;
    const lift = (elevation * Math.PI) / 180;
    const target: Vec3 = [x, y + SUBJECT_HEIGHT, z];
    return {
        target,
        position: [
            target[0] + Math.sin(turn) * Math.cos(lift) * distance,
            target[1] + Math.sin(lift) * distance,
            target[2] + Math.cos(turn) * Math.cos(lift) * distance
        ],
        fov
    };
}

export const FOCUS: Record<GameId, Frame> = {
    hokm: around('hokm', -30, 32, 1.55, 30),
    poker: around('poker', 32, 30, 1.55, 30),
    backgammon: around('backgammon', -26, 34, 1.6, 30),
    ludo: around('ludo', 30, 34, 1.55, 30)
};

export const SHOTS: Record<string, Frame> = {
    arrival: FOCUS.hokm,
    games: { position: [10.4, 4.0, 10.4], target: [-0.6, 0.1, 0], fov: 20 },
    together: FOCUS.ludo,
    compete: FOCUS.backgammon,
    finale: FOCUS.poker
};
