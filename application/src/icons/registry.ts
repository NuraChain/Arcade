import {
    Activity,
    ArrowRight,
    ChevronDown,
    Compass,
    Gamepad2,
    History,
    Lightbulb,
    Link2,
    Lock,
    Medal,
    Menu,
    MessageCircle,
    Mic,
    Play,
    RefreshCw,
    Spade,
    Star,
    Swords,
    TriangleAlert,
    Trophy,
    UserPlus,
    Users,
    Wallet,
    X,
    type IconNode
} from 'lucide';

import type { IconName } from './all.ts';

export type { IconName };

export const ICONS: Partial<Record<IconName, IconNode>> = {
    'activity': Activity,
    'alert': TriangleAlert,
    'cards': Spade,
    'chats': MessageCircle,
    'chevron-down': ChevronDown,
    'close': X,
    'discover': Compass,
    'forward': ArrowRight,
    'friend-add': UserPlus,
    'games': Gamepad2,
    'history': History,
    'invite': Link2,
    'lock': Lock,
    'medal': Medal,
    'menu': Menu,
    'people': Users,
    'play': Play,
    'refresh': RefreshCw,
    'star': Star,
    'trophy': Trophy,
    'versus': Swords,
    'voice': Mic,
    'wallet': Wallet,
    'idea': Lightbulb
};

export function registerIcons(more: Readonly<Partial<Record<IconName, IconNode>>>): void
{
    Object.assign(ICONS, more);
}
