import {
    ClampToEdgeWrapping,
    LinearFilter,
    LinearMipmapLinearFilter,
    Mesh,
    NoColorSpace,
    RepeatWrapping,
    SRGBColorSpace,
    TextureLoader,
    type BufferGeometry,
    type Group,
    type Object3D,
    type Texture
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

import { GAMES, type SetAsset, type TableAsset } from '../../data/games.ts';
import type { MaterialSet } from '../render/materials.ts';
import type { QualitySettings } from '../quality/tiers.ts';

export const AVATARS = ['avatar-a', 'avatar-b', 'avatar-c'] as const;

export type AvatarAsset = typeof AVATARS[number];

export const FURNITURE = [
    'lamp-pendant',
    'table-round',
    'stool',
    'trophy',
    ...AVATARS
] as const;

export type FurnitureAsset = typeof FURNITURE[number];

export type AssetName = FurnitureAsset | TableAsset | SetAsset;

export type AssetLibrary = Partial<Record<AssetName, Group>>;

export interface LoadedAssets
{
    library: AssetLibrary;
    atlas: Texture;
    wood: Texture;
    woodNormal: Texture;
    get(name: AssetName): Group;
    dispose(): void;
}

export function requiredAssets(): AssetName[]
{
    const names = new Set<AssetName>(FURNITURE);
    for (const game of GAMES)
    {
        names.add(game.table);
        if (game.set !== undefined)
        {
            names.add(game.set);
        }
    }
    return [...names];
}

export async function loadAssets(
    base: string,
    materials: MaterialSet,
    settings: QualitySettings,
    signal?: AbortSignal
): Promise<LoadedAssets>
{
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const geometries = new Set<BufferGeometry>();
    const textures = new TextureLoader();

    const image = async (file: string, colour: boolean, repeat: boolean): Promise<Texture> =>
    {
        const texture = await textures.loadAsync(`${ base }/${ file }`);
        texture.flipY = false;
        texture.colorSpace = colour ? SRGBColorSpace : NoColorSpace;
        texture.wrapS = repeat ? RepeatWrapping : ClampToEdgeWrapping;
        texture.wrapT = repeat ? RepeatWrapping : ClampToEdgeWrapping;
        texture.minFilter = LinearMipmapLinearFilter;
        texture.magFilter = LinearFilter;
        texture.anisotropy = settings.anisotropy;
        texture.generateMipmaps = true;
        texture.needsUpdate = true;
        return texture;
    };

    const one = async (name: AssetName): Promise<[AssetName, Group]> =>
    {
        const gltf = await loader.loadAsync(`${ base }/${ name }.glb`);

        gltf.scene.traverse((node: Object3D) =>
        {
            if (!(node instanceof Mesh))
            {
                return;
            }

            const family = Array.isArray(node.material)
                ? node.material[0]?.name
                : node.material?.name;

            node.material = materials.get(family ?? 'wood');
            node.castShadow = true;
            node.receiveShadow = true;
            node.matrixAutoUpdate = false;

            geometries.add(node.geometry);
        });

        return [name, gltf.scene];
    };

    const [loaded, atlas, wood, woodNormal] = await Promise.all([
        Promise.all(requiredAssets().map((name) => one(name))),
        image(`atlas-${ settings.atlas }.webp`, true, false),
        image('wood-512.webp', true, true),
        image('wood-normal-512.webp', false, true)
    ]);

    if (signal?.aborted === true)
    {
        for (const geometry of geometries)
        {
            geometry.dispose();
        }
        atlas.dispose();
        wood.dispose();
        woodNormal.dispose();
        throw new DOMException('Aborted', 'AbortError');
    }

    materials.setAtlas(atlas);
    materials.setWood(wood, woodNormal);
    const library = Object.fromEntries(loaded) as AssetLibrary;

    return {
        library,
        atlas,
        wood,
        woodNormal,

        get(name)
        {
            const group = library[name];
            if (group === undefined)
            {
                throw new Error(`world: asset "${ name }" was not loaded`);
            }
            return group;
        },

        dispose()
        {
            for (const geometry of geometries)
            {
                geometry.dispose();
            }
            geometries.clear();
        }
    };
}
