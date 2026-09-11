import qrcode from 'qrcode-generator';

export interface QrCode
{
    /** Modules per side, quiet zone excluded. */
    size: number;

    /** One SVG path covering every dark module, in module units. */
    path: string;
}

/**
 * A URL as an SVG path.
 *
 * One path rather than a grid of rects: a 25x25 code is 300-odd dark modules, and 300 elements is
 * 300 things for the browser to lay out for a picture that never changes.
 *
 * Error correction stays at M. A code shown on a screen is not a code printed on a box - nothing
 * is going to smudge it - and every level above M makes the modules smaller for the camera.
 */
export function qrOf(text: string): QrCode
{
    const code = qrcode(0, 'M');
    code.addData(text);
    code.make();

    const size = code.getModuleCount();
    let path = '';

    for (let row = 0; row < size; row += 1)
    {
        for (let column = 0; column < size; column += 1)
        {
            if (code.isDark(row, column))
            {
                path += `M${ column } ${ row }h1v1h-1z`;
            }
        }
    }

    return { size, path };
}
