export const NOTICES = ['invites', 'requests', 'messages', 'groups', 'turns'] as const;

export type Notice = typeof NOTICES[number];

export const NOTICE_OF: Readonly<Record<string, Notice>> = {
    'friend-request': 'requests',
    'friend-accepted': 'requests',
    'group-added': 'groups',
    'table-invite': 'invites',
    'message': 'messages',
    'turn': 'turns'
};

export const isNotice = (value: string): value is Notice => (NOTICES as readonly string[]).includes(value);
