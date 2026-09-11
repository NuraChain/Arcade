import {
    BoxGeometry,
    Color,
    Group,
    InstancedMesh,
    Mesh,
    MeshBasicMaterial,
    Object3D,
    PointLight,
    Vector3,
    type BufferGeometry,
    type Material,
    type Texture
} from 'three';

import {
    ARENA_ANCHOR,
    GAMES,
    PLAZA_ANCHOR,
    SET_SURFACE,
    TABLE_RADIUS,
    TABLE_TOP,
    seatAround,
    type GameId,
    type SetAsset,
    type TableName
} from '../../data/games.ts';
import { AVATARS, type LoadedAssets } from '../assets/loader.ts';
import { damping } from '../camera/path.ts';
import type { MaterialSet } from '../render/materials.ts';
import type { QualitySettings } from '../quality/tiers.ts';
import { createLamp, type Lamp } from './lamps.ts';
import { createBridge, createSlab } from './procedural.ts';

export interface Market
{
    root: Object3D;

    proxies: Mesh[];

    setFocus(id: GameId | null): void;
    applyTier(settings: QualitySettings): void;
    update(time: number, deltaMs: number, focus: Vector3): void;
    dispose(): void;
}

interface Station
{
    id: GameId | 'plaza' | 'arena';
    anchor: Vector3;
    lamp: Lamp;
}

interface Beam
{
    light: PointLight;
    station: Station | null;
    level: number;
}

const BEAM_RATE = 0.06;
const BEAM_RANGE = 9;

interface Guest
{
    position: Vector3;
    facing: number;
    tint: Color;
    variant: number;
}

const CROWD = [
    new Color('#C96F5A'),
    new Color('#4E7C8C'),
    new Color('#5E8C63'),
    new Color('#C9A24A'),
    new Color('#7A4B6E'),
    new Color('#D9CDB5'),
    new Color('#8C3B3B'),
    new Color('#2F5C7A')
];

function instanceAsset(source: Object3D, count: number): { meshes: InstancedMesh[]; tintable: boolean[] }
{
    const meshes: InstancedMesh[] = [];
    const tintable: boolean[] = [];

    source.traverse((node) =>
    {
        if (!(node instanceof Mesh))
        {
            return;
        }
        const instanced = new InstancedMesh(node.geometry as BufferGeometry, node.material as Material, count);
        instanced.castShadow = true;
        instanced.receiveShadow = true;
        meshes.push(instanced);
        tintable.push(node.name.startsWith('Shirt'));
    });

    return { meshes, tintable };
}

function freeze(object: Object3D): void
{
    object.updateMatrix();
    object.matrixAutoUpdate = false;
}

export interface MarketOptions
{
    assets: LoadedAssets;
    materials: MaterialSet;
    settings: QualitySettings;
    lampColour: Color;
    stoneColour: Color;
    woodColour: Color;

    poolTexture: Texture;
    glowTexture: Texture;
}

export function createMarket(options: MarketOptions): Market
{
    const root = new Group();
    const pool = options.poolTexture;
    const glow = options.glowTexture;
    const stations: Station[] = [];
    const proxies: Mesh[] = [];
    const disposables: BufferGeometry[] = [];

    const proxyMaterial = new MeshBasicMaterial({ visible: false });

    const seatPositions: Vector3[] = [];
    const guests: Guest[] = [];

    const addTable = (
        id: GameId | 'plaza',
        anchor: Vector3,
        tableName: TableName,
        setName: SetAsset | undefined,
        rotation: number,
        seats: number,
        seatPhase: number
    ): void =>
    {
        const radius = TABLE_RADIUS[tableName];
        const top = TABLE_TOP[tableName];

        const table = options.assets.get(tableName).clone(true);
        table.position.copy(anchor);
        table.rotation.y = -rotation;
        freeze(table);
        root.add(table);

        const slabGeometry = createSlab(radius * 1.5, options.stoneColour);
        const slab = new Mesh(slabGeometry, options.materials.get('wood'));
        slab.position.copy(anchor);
        slab.receiveShadow = true;
        freeze(slab);
        root.add(slab);
        disposables.push(slabGeometry);

        let surface = top;
        if (setName !== undefined && options.assets.library[setName] !== undefined)
        {
            const set = options.assets.get(setName).clone(true);
            set.position.set(anchor.x, anchor.y + top, anchor.z);
            set.rotation.y = -rotation;
            freeze(set);
            root.add(set);
            surface = top + SET_SURFACE[setName];
        }

        const lamp = createLamp({
            fitting: options.assets.get('lamp-pendant'),
            height: 3.05,
            poolRadius: radius * 0.82,
            tableTop: surface,
            colour: options.lampColour,
            poolTexture: pool,
            glowTexture: glow,
            phase: stations.length * 1.7
        });
        lamp.root.position.copy(anchor);
        root.add(lamp.root);
        stations.push({ id, anchor, lamp });

        for (let seat = 0; seat < seats; seat += 1)
        {
            const angle = rotation + seatPhase + (seat / seats) * Math.PI * 2;
            const placed = seatAround(tableName, angle, rotation);
            const position = new Vector3(anchor.x + placed.x, anchor.y, anchor.z + placed.z);
            seatPositions.push(position);

            const ordinal = seat + stations.length * 3;
            if (ordinal % 3 !== 0)
            {
                guests.push({
                    position: new Vector3(position.x, anchor.y + 0.46, position.z),
                    facing: placed.facing,
                    tint: CROWD[(ordinal * 5) % CROWD.length],
                    variant: (ordinal * 7) % AVATARS.length
                });
            }
        }

        if (id !== 'plaza')
        {
            const proxyGeometry = new BoxGeometry(radius * 2.6, 2.4, radius * 2.6);
            const proxy = new Mesh(proxyGeometry, proxyMaterial);
            proxy.position.set(anchor.x, anchor.y + 1.0, anchor.z);
            proxy.userData.gameId = id;
            freeze(proxy);
            root.add(proxy);
            proxies.push(proxy);
            disposables.push(proxyGeometry);
        }
    };

    const plaza = new Vector3(...PLAZA_ANCHOR);
    addTable('plaza', plaza, 'table-round', undefined, 0, 6, 0);

    for (const game of GAMES)
    {
        const anchor = new Vector3(...game.anchor);
        const phase = game.table === 'table-poker' ? Math.PI / 4 : 0;
        addTable(game.id, anchor, game.table, game.set, game.rotation, Math.min(game.maxPlayers, 4), phase);
    }

    for (const game of GAMES)
    {
        const anchor = new Vector3(...game.anchor);
        const radius = TABLE_RADIUS[game.table];

        const start = new Vector3(plaza.x, plaza.y - 0.16, plaza.z);
        const end = new Vector3(anchor.x, anchor.y - 0.16, anchor.z);
        const along = new Vector3().subVectors(end, start).normalize();

        start.addScaledVector(along, 1.1 * 1.5 - 0.15);
        end.addScaledVector(along, -(radius * 1.5 - 0.15));

        const geometry = createBridge(start, end, 0.52, options.stoneColour);
        const bridge = new Mesh(geometry, options.materials.get('wood'));
        bridge.receiveShadow = true;
        freeze(bridge);
        root.add(bridge);
        disposables.push(geometry);
    }

    const arena = new Vector3(...ARENA_ANCHOR);
    const arenaSlabGeometry = createSlab(3.2, options.stoneColour);
    const arenaSlab = new Mesh(arenaSlabGeometry, options.materials.get('wood'));
    arenaSlab.position.copy(arena);
    freeze(arenaSlab);
    root.add(arenaSlab);
    disposables.push(arenaSlabGeometry);

    const trophy = options.assets.get('trophy').clone(true);
    trophy.position.set(arena.x, arena.y, arena.z);
    trophy.scale.setScalar(2.4);
    freeze(trophy);
    root.add(trophy);

    const arenaLamp = createLamp({
        fitting: options.assets.get('lamp-pendant'),
        height: 4.6,
        poolRadius: 2.6,
        tableTop: 0.05,
        intensity: 1.5,
        colour: options.lampColour,
        poolTexture: pool,
        glowTexture: glow,
        phase: 4.2
    });
    arenaLamp.root.position.copy(arena);
    root.add(arenaLamp.root);
    stations.push({ id: 'arena', anchor: arena, lamp: arenaLamp });

    const dummy = new Object3D();
    const instanced: InstancedMesh[] = [];

    const stools = instanceAsset(options.assets.get('stool'), seatPositions.length);
    seatPositions.forEach((position, index) =>
    {
        dummy.position.copy(position);
        dummy.rotation.set(0, index * 0.7, 0);
        dummy.updateMatrix();
        for (const mesh of stools.meshes)
        {
            mesh.setMatrixAt(index, dummy.matrix);
        }
    });
    for (const mesh of stools.meshes)
    {
        mesh.instanceMatrix.needsUpdate = true;
        root.add(mesh);
        instanced.push(mesh);
    }

    AVATARS.forEach((name, variant) =>
    {
        const seated = guests.filter((guest) => guest.variant === variant);
        if (seated.length === 0)
        {
            return;
        }
        const crowd = instanceAsset(options.assets.get(name), seated.length);
        seated.forEach((guest, index) =>
        {
            dummy.position.copy(guest.position);
            dummy.rotation.set(0, Math.PI / 2 - guest.facing, 0);
            dummy.updateMatrix();
            crowd.meshes.forEach((mesh, meshIndex) =>
            {
                mesh.setMatrixAt(index, dummy.matrix);
                if (crowd.tintable[meshIndex])
                {
                    mesh.setColorAt(index, guest.tint);
                }
            });
        });
        for (const mesh of crowd.meshes)
        {
            mesh.instanceMatrix.needsUpdate = true;
            if (mesh.instanceColor !== null)
            {
                mesh.instanceColor.needsUpdate = true;
            }
            root.add(mesh);
            instanced.push(mesh);
        }
    });

    const beams: Beam[] = [];
    const ranked: Station[] = [];

    const placeBeam = (beam: Beam, station: Station): void =>
    {
        beam.station = station;
        beam.light.position.set(station.anchor.x, station.anchor.y + station.lamp.lightHeight, station.anchor.z);
        beam.light.distance = Math.max(BEAM_RANGE, station.lamp.poolRadius * 4);
    };

    const updateBeams = (deltaMs: number, focus: Vector3): void =>
    {
        if (beams.length === 0)
        {
            return;
        }

        ranked.length = 0;
        ranked.push(...stations);
        ranked.sort((a, b) =>
            Math.hypot(a.anchor.x - focus.x, a.anchor.z - focus.z) - Math.hypot(b.anchor.x - focus.x, b.anchor.z - focus.z));
        const wanted = ranked.slice(0, beams.length);
        const rate = damping(BEAM_RATE, deltaMs);

        for (const beam of beams)
        {
            const keep = beam.station !== null && wanted.includes(beam.station);
            beam.level += ((keep ? 1 : 0) - beam.level) * rate;

            if (!keep && beam.level < 0.02)
            {
                const free = wanted.find((station) => !beams.some((other) => other.station === station));
                if (free !== undefined)
                {
                    placeBeam(beam, free);
                    beam.level = 0;
                }
                else
                {
                    beam.station = null;
                }
            }

            const station = beam.station;
            beam.light.intensity = station === null
                ? 0
                : (2.6 + station.lamp.level() * 2.2) * station.lamp.poolRadius * station.lamp.gain * beam.level;
        }
    };

    return {
        root,
        proxies,

        setFocus(id)
        {
            for (const station of stations)
            {
                station.lamp.setFocus(station.id === id);
            }
        },

        applyTier(settings)
        {
            while (beams.length < settings.realLights)
            {
                const light = new PointLight(options.lampColour, 0, BEAM_RANGE, 2);
                root.add(light);
                beams.push({ light, station: null, level: 0 });
            }
            while (beams.length > settings.realLights)
            {
                const beam = beams.pop();
                if (beam !== undefined)
                {
                    root.remove(beam.light);
                    beam.light.dispose();
                }
            }
        },

        update(time, deltaMs, focus)
        {
            for (const station of stations)
            {
                station.lamp.update(time, deltaMs);
            }
            updateBeams(deltaMs, focus);
        },

        dispose()
        {
            for (const station of stations)
            {
                station.lamp.dispose();
            }
            for (const beam of beams)
            {
                beam.light.dispose();
            }
            for (const geometry of disposables)
            {
                geometry.dispose();
            }
            for (const mesh of instanced)
            {
                mesh.dispose();
            }
            proxyMaterial.dispose();
        }
    };
}
