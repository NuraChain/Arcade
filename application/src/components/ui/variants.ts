export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'destructive' | 'live';
export type ButtonSize = 'sm' | 'md' | 'lg';
export type Tone = 'neutral' | 'lamp' | 'live' | 'madder' | 'win';
export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';

export const BUTTON_VARIANT: Record<ButtonVariant, string> = {
    primary: 'bg-lamp text-void hover:brightness-110 active:brightness-95',
    secondary: 'bg-raised text-text hover:bg-line active:brightness-95',
    outline: 'border border-line text-text hover:border-lamp',
    ghost: 'text-muted hover:text-text hover:bg-raised/60',
    destructive: 'bg-madder/15 text-madder hover:bg-madder/25',
    live: 'bg-live text-void hover:brightness-110 active:brightness-95'
};

export const BUTTON_SIZE: Record<ButtonSize, string> = {
    sm: 'h-9 gap-1.5 px-3.5 text-[13px]',
    md: 'h-11 gap-2 px-5 text-[14px]',
    lg: 'h-13 gap-2.5 px-7 text-[15px]'
};

export const ICON_BUTTON_SIZE: Record<ButtonSize, string> = {
    sm: 'h-9 w-9',
    md: 'h-11 w-11',
    lg: 'h-13 w-13'
};

export const TONE_TEXT: Record<Tone, string> = {
    neutral: 'text-muted',
    lamp: 'text-lamp',
    live: 'text-live',
    madder: 'text-madder',
    win: 'text-win'
};

export const TONE_FILL: Record<Tone, string> = {
    neutral: 'bg-raised text-text',
    lamp: 'bg-lamp text-void',
    live: 'bg-live text-void',
    madder: 'bg-madder text-white',
    win: 'bg-win text-void'
};

export const TONE_SOFT: Record<Tone, string> = {
    neutral: 'bg-raised text-muted',
    lamp: 'bg-lamp/15 text-lamp',
    live: 'bg-live/15 text-live',
    madder: 'bg-madder/15 text-madder',
    win: 'bg-win/15 text-win'
};

export const TONE_BAR: Record<Tone, string> = {
    neutral: 'bg-muted',
    lamp: 'bg-lamp',
    live: 'bg-live',
    madder: 'bg-madder',
    win: 'bg-win'
};

export const AVATAR_SIZE: Record<AvatarSize, string> = {
    xs: 'h-6 w-6 text-[10px]',
    sm: 'h-8 w-8 text-[12px]',
    md: 'h-10 w-10 text-[14px]',
    lg: 'h-14 w-14 text-[18px]',
    xl: 'h-20 w-20 text-[26px]',
    '2xl': 'h-28 w-28 text-[36px]'
};

export const AVATAR_DOT: Record<AvatarSize, string> = {
    xs: 'h-2 w-2 ring-1',
    sm: 'h-2.5 w-2.5 ring-2',
    md: 'h-3 w-3 ring-2',
    lg: 'h-3.5 w-3.5 ring-2',
    xl: 'h-4 w-4 ring-[3px]',
    '2xl': 'h-5 w-5 ring-4'
};
