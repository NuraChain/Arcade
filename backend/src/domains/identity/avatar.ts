export type AvatarType = 'image/webp' | 'image/jpeg' | 'image/png';

export const AVATAR_MAX_BYTES = 65_536;

const EXTENSION: Record<AvatarType, string> = {
    'image/webp': 'webp',
    'image/jpeg': 'jpg',
    'image/png': 'png'
};

const FILE = /^([0-9a-f]{64})\.(webp|jpg|png)$/;

const opensWith = (bytes: Uint8Array, at: number, expected: readonly number[]) =>
    expected.every((value, index) => bytes[at + index] === value);

export function sniffAvatar(bytes: Uint8Array): AvatarType | null
{
    if (opensWith(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    {
        return 'image/png';
    }
    if (opensWith(bytes, 0, [0xff, 0xd8, 0xff]))
    {
        return 'image/jpeg';
    }
    if (opensWith(bytes, 0, [0x52, 0x49, 0x46, 0x46]) && opensWith(bytes, 8, [0x57, 0x45, 0x42, 0x50]))
    {
        return 'image/webp';
    }
    return null;
}

export function avatarUrl(origin: string, hash: string, type: AvatarType)
{
    return `${ origin }/avatars/${ hash }.${ EXTENSION[type] }`;
}

export function avatarFile(name: string)
{
    return FILE.exec(name)?.[1] ?? null;
}

export function avatarHashOf(origin: string, url: string)
{
    const prefix = `${ origin }/avatars/`;
    return url.startsWith(prefix) ? avatarFile(url.slice(prefix.length)) : null;
}
