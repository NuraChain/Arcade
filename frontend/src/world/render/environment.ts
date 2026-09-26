import {
    Color,
    DoubleSide,
    Mesh,
    MeshBasicMaterial,
    PMREMGenerator,
    PlaneGeometry,
    Scene,
    type Texture,
    type WebGLRenderer
} from 'three';

import studio from './studio.json';

export interface Environment
{
    texture: Texture;

    dispose(): void;
}

export const STUDIO = studio;

export function createEnvironment(renderer: WebGLRenderer): Environment
{
    const scene = new Scene();
    scene.background = new Color(0, 0, 0);

    const geometry = new PlaneGeometry(1, 1);
    const materials: MeshBasicMaterial[] = [];

    for (const panel of studio.panels)
    {
        const material = new MeshBasicMaterial({
            color: new Color(panel.colour).multiplyScalar(panel.strength),
            side: DoubleSide
        });
        materials.push(material);

        const mesh = new Mesh(geometry, material);
        mesh.position.set(panel.position[0], panel.position[1], panel.position[2]);
        mesh.scale.set(panel.size[0], panel.size[1], 1);
        mesh.lookAt(0, 0, 0);
        scene.add(mesh);
    }

    const generator = new PMREMGenerator(renderer);
    const target = generator.fromScene(scene, 0, 0.1, 20, { size: 256 });
    generator.dispose();
    geometry.dispose();
    for (const material of materials)
    {
        material.dispose();
    }

    return {
        texture: target.texture,

        dispose()
        {
            target.dispose();
        }
    };
}
