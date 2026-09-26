export const THREAD_PAGE = 40;

export const THREAD_MOST = 400;

export function threadSize(asked: string | undefined): number
{
    const wanted = Number.parseInt(asked ?? '', 10);

    return Number.isFinite(wanted) ? Math.min(Math.max(wanted, 1), THREAD_MOST) : THREAD_PAGE;
}
