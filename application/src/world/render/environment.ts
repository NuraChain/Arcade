import type { Color } from 'three';
import {
    BackSide,
    BoxGeometry,
    CircleGeometry,
    Mesh,
    MeshBasicMaterial,
    PMREMGenerator,
    PlaneGeometry,
    Scene,
    type Texture,
    type WebGLRenderer
} from 'three';

export interface Environment
{
    texture: Texture;
    dispose(): void;
}

export interface EnvironmentOptions
{
    sky: Color;
    lamp: Color;
    fill: Color;
    rim: Color;
}

export function createEnvironment(renderer: WebGLRenderer, options: EnvironmentOptions): Environment
{
    const scene = new Scene();

    const room = new Mesh(
        new BoxGeometry(12, 8, 12),
        new MeshBasicMaterial({ color: options.sky.clone().multiplyScalar(0.6), side: BackSide })
    );
    scene.add(room);

    const lamp = new Mesh(
        new CircleGeometry(1.6, 32),
        new MeshBasicMaterial({ color: options.lamp.clone().multiplyScalar(6) })
    );
    lamp.position.set(0.4, 3.9, 0.2);
    lamp.rotation.x = Math.PI / 2;
    scene.add(lamp);

    const halo = new Mesh(
        new CircleGeometry(3.2, 32),
        new MeshBasicMaterial({ color: options.lamp.clone().multiplyScalar(0.8) })
    );
    halo.position.set(0.4, 3.95, 0.2);
    halo.rotation.x = Math.PI / 2;
    scene.add(halo);

    const cool = new Mesh(
        new PlaneGeometry(6, 3),
        new MeshBasicMaterial({ color: options.rim.clone().multiplyScalar(1.4) })
    );
    cool.position.set(0, 1.5, -5.9);
    scene.add(cool);

    const bounce = new Mesh(
        new PlaneGeometry(10, 10),
        new MeshBasicMaterial({ color: options.fill.clone().multiplyScalar(0.7) })
    );
    bounce.position.set(0, -3.9, 0);
    bounce.rotation.x = -Math.PI / 2;
    scene.add(bounce);

    const generator = new PMREMGenerator(renderer);
    generator.compileEquirectangularShader();
    const target = generator.fromScene(scene, 0.04);
    generator.dispose();

    for (const mesh of [room, lamp, halo, cool, bounce])
    {
        mesh.geometry.dispose();
        (mesh.material as MeshBasicMaterial).dispose();
    }

    return {
        texture: target.texture,
        dispose()
        {
            target.dispose();
        }
    };
}
