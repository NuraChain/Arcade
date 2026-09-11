export type ButtonVariant = 'primary' | 'outline' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';
export type Tone = 'neutral' | 'accent' | 'live';

export const TONE_CLASS: Record<Tone, string> = {
    neutral: 'bg-raised text-muted',
    accent: 'bg-raised text-lamp',
    live: 'bg-raised text-madder'
};

export const BUTTON_VARIANT: Record<ButtonVariant, string> = {
    primary: 'bg-lamp text-void hover:brightness-110',
    outline: 'border border-line text-text hover:border-lamp',
    ghost: 'text-muted hover:text-text'
};

export const BUTTON_SIZE: Record<ButtonSize, string> = {
    sm: 'h-9 gap-1.5 px-3.5 text-[13px]',
    md: 'h-11 gap-2 px-5 text-[14px]',
    lg: 'h-13 gap-2.5 px-7 text-[15px]'
};
