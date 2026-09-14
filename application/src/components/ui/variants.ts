export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'destructive' | 'live';
export type ButtonSize = 'sm' | 'md' | 'lg';
export type Tone = 'neutral' | 'accent' | 'live' | 'gold' | 'win' | 'danger' | 'madder';
export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';
export type BadgeVariant = 'solid' | 'soft' | 'outline';
export type BadgeSize = 'sm' | 'md';

/**
 * The tones a Panel can wear. `madder` is absent on purpose: it means a table is playing for
 * something, and the destructive colour is `danger`. Leaving it out makes the wrong one unwritable.
 */
export type PanelTone = 'field' | 'sunk' | 'accent' | 'live' | 'danger' | 'dashed';
export type PanelPad = 'none' | 'sm' | 'md' | 'lg';
export type PanelStack = 'none' | 'sm' | 'md';

export const BUTTON_VARIANT: Record<ButtonVariant, string> = {
    primary: 'bg-accent text-accent-ink hover:brightness-110 active:brightness-95',
    secondary: 'bg-raised text-text hover:bg-line-strong active:brightness-95',
    outline: 'border border-line-strong text-text hover:border-accent hover:text-accent',
    ghost: 'text-muted hover:bg-raised hover:text-text',
    destructive: 'bg-danger/15 text-danger hover:bg-danger/25',
    live: 'bg-live text-accent-ink hover:brightness-110 active:brightness-95'
};

export const BUTTON_SIZE: Record<ButtonSize, string> = {
    sm: 'h-8 coarse:h-11 gap-1.5 px-3 text-ui-sm',
    md: 'h-10 coarse:h-11 gap-2 px-4 text-ui-base',
    lg: 'h-12 gap-2.5 px-6 text-ui-md'
};

export const ICON_BUTTON_SIZE: Record<ButtonSize, string> = {
    sm: 'h-8 w-8 coarse:h-11 coarse:w-11',
    md: 'h-10 w-10 coarse:h-11 coarse:w-11',
    lg: 'h-12 w-12'
};

export const TONE_TEXT: Record<Tone, string> = {
    neutral: 'text-muted',
    accent: 'text-accent',
    live: 'text-live',
    gold: 'text-gold',
    win: 'text-win',
    danger: 'text-danger',
    madder: 'text-madder'
};

export const TONE_FILL: Record<Tone, string> = {
    neutral: 'bg-raised text-text',
    accent: 'bg-accent text-accent-ink',
    live: 'bg-live text-accent-ink',
    gold: 'bg-gold text-accent-ink',
    win: 'bg-win text-accent-ink',
    danger: 'bg-danger text-accent-ink',
    madder: 'bg-madder text-accent-ink'
};

export const TONE_SOFT: Record<Tone, string> = {
    neutral: 'bg-raised text-muted',
    accent: 'bg-accent/15 text-accent',
    live: 'bg-live/15 text-live',
    gold: 'bg-gold/15 text-gold',
    win: 'bg-win/15 text-win',
    danger: 'bg-danger/15 text-danger',
    madder: 'bg-madder/15 text-madder'
};

export const TONE_OUTLINE: Record<Tone, string> = {
    neutral: 'border border-line-strong text-muted',
    accent: 'border border-accent/50 text-accent',
    live: 'border border-live/50 text-live',
    gold: 'border border-gold/50 text-gold',
    win: 'border border-win/50 text-win',
    danger: 'border border-danger/50 text-danger',
    madder: 'border border-madder/50 text-madder'
};

export const TONE_BAR: Record<Tone, string> = {
    neutral: 'bg-muted',
    accent: 'bg-accent',
    live: 'bg-live',
    gold: 'bg-gold',
    win: 'bg-win',
    danger: 'bg-danger',
    madder: 'bg-madder'
};

export const TONE_DOT: Record<Tone, string> = {
    neutral: 'bg-faint',
    accent: 'bg-accent',
    live: 'bg-live',
    gold: 'bg-gold',
    win: 'bg-win',
    danger: 'bg-danger',
    madder: 'bg-madder'
};

export const BADGE_SIZE: Record<BadgeSize, string> = {
    sm: 'h-4 min-w-4 px-1 text-ui-2xs',
    md: 'h-5 min-w-5 px-1.5 text-ui-xs'
};

export const BADGE_DOT_SIZE: Record<BadgeSize, string> = {
    sm: 'h-1.5 w-1.5',
    md: 'h-2 w-2'
};

export const AVATAR_SIZE: Record<AvatarSize, string> = {
    xs: 'h-6 w-6 text-ui-2xs',
    sm: 'h-8 w-8 text-ui-xs',
    md: 'h-10 w-10 text-ui-base',
    lg: 'h-13 w-13 text-ui-lg',
    xl: 'h-18 w-18 text-ui-2xl',
    '2xl': 'h-24 w-24 text-ui-4xl'
};

export const AVATAR_DOT: Record<AvatarSize, string> = {
    xs: 'h-2 w-2 ring-1',
    sm: 'h-2.5 w-2.5 ring-2',
    md: 'h-3 w-3 ring-2',
    lg: 'h-3.5 w-3.5 ring-2',
    xl: 'h-4 w-4 ring-[3px]',
    '2xl': 'h-5 w-5 ring-4'
};

export const PANEL_TONE: Record<PanelTone, string> = {
    field: 'border border-line bg-field',
    sunk: 'border border-line bg-sunk',
    accent: 'border border-accent/40 bg-accent/5',
    live: 'border border-live/40 bg-live/5',
    danger: 'border border-danger/40 bg-danger/5',
    dashed: 'border border-dashed border-line'
};

export const PANEL_HOVER: Record<PanelTone, string> = {
    field: 'hover:border-line-strong hover:bg-raised/60',
    sunk: 'hover:border-line-strong',
    accent: 'hover:bg-accent/10',
    live: 'hover:bg-live/10',
    danger: 'hover:bg-danger/10',
    dashed: 'hover:border-line-strong'
};

export const PANEL_PAD: Record<PanelPad, string> = {
    none: '',
    sm: 'p-3',
    md: 'p-4',
    lg: 'p-6'
};

export const PANEL_STACK: Record<PanelStack, string> = {
    none: '',
    sm: 'flex flex-col gap-3',
    md: 'flex flex-col gap-4'
};

export const PANEL_GLOW: Record<PanelTone, string> = {
    field: '',
    sunk: '',
    accent: 'shadow-glow-accent',
    live: 'shadow-glow-live',
    danger: '',
    dashed: ''
};
