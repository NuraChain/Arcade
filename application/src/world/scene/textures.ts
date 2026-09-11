import { CanvasTexture, SRGBColorSpace, type Texture } from 'three';

function radial(size: number, stops: Array<[number, string]>): Texture
{
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;

    const context = canvas.getContext('2d');
    if (context === null)
    {
        return new CanvasTexture(canvas);
    }

    const half = size / 2;
    const gradient = context.createRadialGradient(half, half, 0, half, half, half);
    for (const [offset, colour] of stops)
    {
        gradient.addColorStop(offset, colour);
    }

    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);

    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    return texture;
}

export function lightPoolTexture(): Texture
{
    return radial(256, [
        [0, 'rgba(255,255,255,0.95)'],
        [0.35, 'rgba(255,255,255,0.55)'],
        [0.7, 'rgba(255,255,255,0.13)'],
        [1, 'rgba(255,255,255,0)']
    ]);
}

export function glowTexture(): Texture
{
    return radial(128, [
        [0, 'rgba(255,255,255,1)'],
        [0.18, 'rgba(255,255,255,0.6)'],
        [0.5, 'rgba(255,255,255,0.12)'],
        [1, 'rgba(255,255,255,0)']
    ]);
}
