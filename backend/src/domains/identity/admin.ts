export function isAdminAddress(address: string | null, admin: string)
{
    return admin !== '' && address !== null && address.toLowerCase() === admin.toLowerCase();
}
