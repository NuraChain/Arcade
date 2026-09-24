export type OverlayPanel = 'sheet' | 'modal' | 'popover';

export const OVERLAY_PANEL: Record<OverlayPanel, string> = {
    sheet: 'absolute inset-x-0 inset-be-0 max-block-[88dvh] flex flex-col rounded-ss-sheet rounded-se-sheet bg-lifted [box-shadow:var(--shadow-3)] safe-b [transition:transform_var(--duration-sheet)_var(--ease-reveal)] will-change-transform',
    modal: 'absolute inset-bs-1/2 inset-s-1/2 [translate:-50%_-50%] rtl:[translate:50%_-50%] inline-[min(32rem,calc(100%-2rem))] max-block-[86dvh] flex flex-col rounded-panel border border-line bg-lifted [box-shadow:var(--shadow-3)] [transition:transform_var(--duration-ui)_var(--ease-reveal),opacity_var(--duration-ui)_var(--ease-ui)]',
    popover: 'absolute min-inline-48 rounded-tile border border-line bg-lifted [box-shadow:var(--shadow-2)] [transition:transform_var(--duration-fast)_var(--ease-ui),opacity_var(--duration-fast)_var(--ease-ui)]'
};

export const OVERLAY_RESTING: Record<OverlayPanel, string> = {
    sheet: '[transform:translateY(var(--detent,0px))]',
    modal: '',
    popover: ''
};

export const OVERLAY_HIDDEN: Record<OverlayPanel, string> = {
    sheet: '[transform:translateY(100%)]',
    modal: 'opacity-0 [transform:scale(0.96)]',
    popover: 'opacity-0 [transform:translateY(-4px)]'
};

export const OVERLAY_SCRIM = 'overlay-scrim absolute inset-0 bg-(--scrim) touch-none [transition:opacity_var(--duration-sheet)_var(--ease-ui)]';
