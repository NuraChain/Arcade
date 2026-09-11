import {
    Color,
    MeshBasicMaterial,
    MeshPhysicalMaterial,
    MeshStandardMaterial,
    Vector2,
    type Material,
    type Texture
} from 'three';

import type { QualitySettings } from '../quality/tiers.ts';

export type MaterialFamily =
    | 'felt'
    | 'wood'
    | 'brass'
    | 'ivory'
    | 'enamel'
    | 'glow'
    | 'print'
    | 'lacquer'
    | 'leather'
    | 'glass'
    | 'skin'
    | 'cloth'
    | 'hair';

export interface MaterialSet
{
    get(family: string): Material;
    setAtlas(texture: Texture): void;
    setWood(colour: Texture, normal: Texture): void;
    setEnvironmentIntensity(scale: number): void;
    dispose(): void;
}

const ENVIRONMENT: Record<MaterialFamily, number> = {
    felt: 0.2,
    wood: 0.8,
    brass: 1.0,
    ivory: 0.5,
    enamel: 0.6,
    glow: 0,
    print: 0.5,
    lacquer: 1.0,
    leather: 0.6,
    glass: 1.0,
    skin: 0.4,
    cloth: 0.25,
    hair: 0.7
};

export function readWorldToken(name: string, fallback: string): Color
{
    if (typeof document === 'undefined')
    {
        return new Color(fallback);
    }
    const value = getComputedStyle(document.documentElement).getPropertyValue(`--world-${ name }`).trim();
    return new Color(value === '' ? fallback : value);
}

export function readWorldScalar(name: string, fallback: number): number
{
    if (typeof document === 'undefined')
    {
        return fallback;
    }
    const value = Number.parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue(`--world-${ name }`)
    );
    return Number.isFinite(value) ? value : fallback;
}

export function createMaterials(settings: QualitySettings): MaterialSet
{
    const standard = (roughness: number, metalness: number): MeshStandardMaterial =>
        new MeshStandardMaterial({ vertexColors: true, roughness, metalness });

    const felt = settings.sheen
        ? new MeshPhysicalMaterial({
            vertexColors: true,
            roughness: 0.95,
            metalness: 0,
            sheen: 0.4,
            sheenRoughness: 0.9,
            sheenColor: new Color('#5C7A6A')
        })
        : standard(0.95, 0);

    const cloth = settings.sheen
        ? new MeshPhysicalMaterial({
            vertexColors: true,
            roughness: 0.88,
            metalness: 0,
            sheen: 0.5,
            sheenRoughness: 0.8,
            sheenColor: new Color('#F1E6D2')
        })
        : standard(0.88, 0);

    const lacquer = new MeshPhysicalMaterial({
        vertexColors: true,
        roughness: 0.18,
        metalness: 0,
        clearcoat: 0.3,
        clearcoatRoughness: 0.25
    });

    const glass = new MeshPhysicalMaterial({
        vertexColors: true,
        roughness: 0.05,
        metalness: 0,
        transmission: 0.9,
        thickness: 0.01,
        ior: 1.5,
        transparent: true
    });

    const print = standard(0.55, 0);
    const wood = standard(0.38, 0);
    wood.normalScale = new Vector2(0.35, 0.35);

    const families: Record<MaterialFamily, Material> = {
        felt,
        wood,
        brass: standard(0.35, 0.7),
        ivory: standard(0.6, 0),
        enamel: standard(0.5, 0),
        glow: new MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
        print,
        lacquer,
        leather: standard(0.68, 0),
        glass,
        skin: standard(0.52, 0),
        cloth,
        hair: standard(0.42, 0)
    };

    const owned: Texture[] = [];

    const applyEnvironment = (scale: number): void =>
    {
        for (const [family, material] of Object.entries(families) as Array<[MaterialFamily, Material]>)
        {
            if (material instanceof MeshStandardMaterial)
            {
                material.envMapIntensity = ENVIRONMENT[family] * scale;
            }
        }
    };

    applyEnvironment(1);

    return {
        get(family)
        {
            const material = families[family as MaterialFamily];
            if (material === undefined)
            {
                console.warn(`[world] no material family "${ family }"; falling back to wood.`);
                return families.wood;
            }
            return material;
        },

        setAtlas(texture)
        {
            owned.push(texture);
            print.map = texture;
            print.needsUpdate = true;
        },

        setWood(colour, normal)
        {
            owned.push(colour, normal);
            wood.map = colour;
            wood.normalMap = normal;
            wood.needsUpdate = true;
        },

        setEnvironmentIntensity(scale)
        {
            applyEnvironment(scale);
        },

        dispose()
        {
            for (const material of Object.values(families))
            {
                material.dispose();
            }
            for (const texture of owned)
            {
                texture.dispose();
            }
        }
    };
}
