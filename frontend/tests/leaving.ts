import { renderTest } from '@azerothjs/testing';
import { RouterProvider, Routes, createMemoryHistory, createRouter, type Route } from 'azerothjs';
import { expect, vi } from 'vitest';

/**
 * Opens `at` among `routes` with the app's own kind of leave, waits until `ready` holds, leaves for a
 * page of nothing, and hands back the container halfway through the leave, the page that is going
 * still in it. A page is about what it was built for: one that followed the address said "No such
 * game." or went back to loading while it faded out.
 */
export async function halfwayOut(routes: Route[], at: string, ready: (container: HTMLElement) => boolean)
{
    const router = createRouter({
        routes: [...routes, { path: '/elsewhere', component: (): HTMLElement => document.createElement('div') }],
        history: createMemoryHistory(at),
        scroll: false
    });
    const { container } = renderTest(() => RouterProvider({ router, children: () => Routes({ transition: () => 'page-forward', transitionDuration: 400 }) }) as HTMLElement);

    await vi.waitFor(() => expect(ready(container)).toBe(true), { timeout: 4000 });

    router.navigate('/elsewhere');
    await new Promise((resolve) => setTimeout(resolve, 150));

    return container;
}
