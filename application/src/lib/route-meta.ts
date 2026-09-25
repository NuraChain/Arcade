import type { RouteMatch } from 'azerothjs';

import type { MessageKey } from '../locales/en.ts';

export type Tab = 'home' | 'games' | 'watch' | 'friends' | 'chats' | 'me' | 'settings' | 'discover' | 'search' | 'leaderboard' | 'notifications';

export interface RouteMeta
{
    title?: MessageKey;
    tab?: Tab;
    parent?: string;
    immersive?: boolean;
    messenger?: boolean;
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

export function parentOf(match: RouteMatch | null): string | undefined
{
    const parent = routeMeta(match).parent;
    if (parent === undefined || match === null)
    {
        return parent;
    }
    return parent.replace(/:(\w+)/g, (whole, name: string) => match.params[name] === undefined ? whole : encodeURIComponent(match.params[name]));
}

export function defineMeta(meta: RouteMeta): Record<string, unknown>
{
    return meta as Record<string, unknown>;
}
