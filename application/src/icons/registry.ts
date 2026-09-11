import {
    ArrowRight,
    Armchair,
    Check,
    ChevronDown,
    Gamepad2,
    History,
    Languages,
    Link2,
    Menu,
    Mic,
    Moon,
    Sun,
    Swords,
    Trophy,
    Users,
    X,
    type IconNode
} from 'lucide';

export const ICONS = {
    'chevron-down': ChevronDown,
    'close': X,
    'forward': ArrowRight,
    'games': Gamepad2,
    'history': History,
    'invite': Link2,
    'language': Languages,
    'menu': Menu,
    'people': Users,
    'seat': Armchair,
    'selected': Check,
    'theme-dawn': Sun,
    'theme-dusk': Moon,
    'trophy': Trophy,
    'versus': Swords,
    'voice': Mic
} satisfies Record<string, IconNode>;

export type IconName = keyof typeof ICONS;
