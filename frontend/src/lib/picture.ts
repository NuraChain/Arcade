const SIDE = 256;
const QUALITY = 0.85;

const encode = (canvas: HTMLCanvasElement, type: string): Promise<Blob | null> =>
    new Promise((resolve) => canvas.toBlob(resolve, type, QUALITY));

const base64Of = (bytes: Uint8Array) =>
{
    let binary = '';
    for (const byte of bytes)
    {
        binary += String.fromCharCode(byte);
    }
    return btoa(binary);
};

export async function shrinkPicture(file: Blob): Promise<{ data: string; preview: string }>
{
    const bitmap = await createImageBitmap(file);
    const side = Math.min(bitmap.width, bitmap.height);

    const canvas = document.createElement('canvas');
    canvas.width = SIDE;
    canvas.height = SIDE;

    const context = canvas.getContext('2d');
    if (context === null)
    {
        bitmap.close();
        throw new Error('This browser cannot draw a picture.');
    }

    context.fillStyle = '#111827';
    context.fillRect(0, 0, SIDE, SIDE);
    context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, SIDE, SIDE);
    bitmap.close();

    let blob = await encode(canvas, 'image/webp');
    if (blob === null || blob.type !== 'image/webp')
    {
        blob = await encode(canvas, 'image/jpeg');
    }
    if (blob === null)
    {
        throw new Error('This browser cannot encode a picture.');
    }

    const data = base64Of(new Uint8Array(await blob.arrayBuffer()));
    return { data, preview: `data:${ blob.type };base64,${ data }` };
}
