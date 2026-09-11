import {
    BoxGeometry,
    CylinderGeometry,
    Float32BufferAttribute,
    Vector3,
    type BufferGeometry,
    type Color
} from 'three';

export function paintGeometry(geometry: BufferGeometry, colour: Color): BufferGeometry
{
    const count = geometry.getAttribute('position').count;
    const colours = new Float32Array(count * 3);

    for (let index = 0; index < count; index += 1)
    {
        colours[index * 3] = colour.r;
        colours[index * 3 + 1] = colour.g;
        colours[index * 3 + 2] = colour.b;
    }

    geometry.setAttribute('color', new Float32BufferAttribute(colours, 3));
    return geometry;
}

export function createSlab(radius: number, colour: Color): BufferGeometry
{
    const geometry = new CylinderGeometry(radius, radius * 0.62, 0.42, 8, 1);
    geometry.translate(0, -0.21, 0);
    return paintGeometry(geometry, colour);
}

export function createBridge(from: Vector3, to: Vector3, width: number, colour: Color): BufferGeometry
{
    const span = from.distanceTo(to);
    const geometry = new BoxGeometry(span, 0.09, width);

    const direction = new Vector3().subVectors(to, from);
    const yaw = Math.atan2(-direction.z, direction.x);
    const pitch = Math.atan2(direction.y, Math.hypot(direction.x, direction.z));

    geometry.rotateZ(pitch);
    geometry.rotateY(yaw);
    geometry.translate(
        (from.x + to.x) / 2,
        (from.y + to.y) / 2,
        (from.z + to.z) / 2
    );

    return paintGeometry(geometry, colour);
}
