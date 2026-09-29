export function isAdminAddress(address: string | null, admin: string): boolean
{
    return admin !== '' && address !== null && address.toLowerCase() === admin.toLowerCase();
}
