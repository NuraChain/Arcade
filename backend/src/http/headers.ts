import { securityHeaders } from '@azerothjs/http';

export const HSTS_SECONDS = 15_552_000;

export function headersFor(production: boolean)
{
    return securityHeaders({
        crossOriginResourcePolicy: false,
        crossOriginOpenerPolicy: false,
        hsts: { maxAgeSeconds: HSTS_SECONDS, includeSubDomains: false },
        trustProxy: production
    });
}
