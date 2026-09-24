import {
    Material,
    Mesh,
    MeshBasicMaterial,
    Texture,
    type BufferGeometry,
    type Group,
    type Object3D
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

import { GAMES } from '../../data/games.ts';
import type { SceneSet } from '../quality/tiers.ts';

export interface Showcase
{
    root: Group;

    textures: Texture[];

    dispose(): void;
}

function texturesOf(material: Material): Texture[]
{
    return Object.values(material).filter((value): value is Texture => value instanceof Texture);
}

function decal(material: Material): MeshBasicMaterial
{
    const source = material as Material & { map?: Texture | null };
    return new MeshBasicMaterial({
        name: material.name,
        map: source.map ?? null,
        transparent: true,
        depthWrite: false,
        toneMapped: false
    });
}

export async function loadShowcase(base: string, set: SceneSet, anisotropy: number): Promise<Showcase>
{
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const gltf = await loader.loadAsync(`${ base }/showcase-${ set }.glb`);
    const root = gltf.scene;

    for (const game of GAMES)
    {
        root.getObjectByName(game.id)?.position.set(...game.anchor);
    }

    const geometries = new Set<BufferGeometry>();
    const materials = new Set<Material>();
    const replaced = new Map<Material, MeshBasicMaterial>();

    root.traverse((node: Object3D) =>
    {
        if (!(node instanceof Mesh))
        {
            return;
        }
        geometries.add(node.geometry);

        const own = (material: Material): Material =>
        {
            if (!material.name.startsWith('decal'))
            {
                materials.add(material);
                return material;
            }
            let swapped = replaced.get(material);
            if (swapped === undefined)
            {
                swapped = decal(material);
                replaced.set(material, swapped);
                materials.add(swapped);
                material.dispose();
            }
            return swapped;
        };

        node.material = Array.isArray(node.material) ? node.material.map(own) : own(node.material);
    });

    root.updateMatrixWorld(true);
    root.traverse((node: Object3D) =>
    {
        node.matrixAutoUpdate = false;
        node.matrixWorldAutoUpdate = false;
    });

    const textures = [...new Set([...materials].flatMap(texturesOf))];
    for (const texture of textures)
    {
        texture.anisotropy = anisotropy;
    }

    return {
        root,
        textures,

        dispose()
        {
            for (const geometry of geometries)
            {
                geometry.dispose();
            }
            for (const material of materials)
            {
                material.dispose();
            }
            for (const texture of textures)
            {
                texture.dispose();
            }
        }
    };
}
