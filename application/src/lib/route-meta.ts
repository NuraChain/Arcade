import type { RouteMatch } from 'azerothjs';

import type { MessageKey } from '../locales/en.ts';

export type Tab = 'home' | 'games' | 'friends' | 'chats' | 'me' | 'discover' | 'search';

export interface RouteMeta
{
    title?: MessageKey;
    tab?: Tab;
    parent?: string;
    immersive?: boolean;
}

export function routeMeta(match: RouteMatch | null): RouteMeta
{
    if (match === null)
    {
        return {};
    }
    const meta = match.route.meta;
    return meta === undefined ? {} : (meta as RouteMeta);
}

export function defineMeta(meta: RouteMeta): Record<string, unknown>
{
    return meta as Record<string, unknown>;
}
