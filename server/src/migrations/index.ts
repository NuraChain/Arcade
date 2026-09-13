import type { MigrationInterface } from 'typeorm';

import { ReferenceCatalogue1789138458214 } from './0001-reference.ts';
import { Identity1789139000000 } from './0002-identity.ts';
import { Social1789147000000 } from './0003-social.ts';
import { Chat1789148500000 } from './0004-chat.ts';
import { Groups1789160000000 } from './0005-groups.ts';
import { Tables1789170000000 } from './0006-tables.ts';
import { DropFairness1789180000000 } from './0007-drop-fairness.ts';
import { Notifications1789190000000 } from './0008-notifications.ts';
import { Devices1789200000000 } from './0009-devices.ts';
import { Attestation1789210000000 } from './0010-attestation.ts';
import { DropDemo1789220000000 } from './0011-drop-demo.ts';
import { Sealing1789230000000 } from './0012-sealing.ts';
import { Recovery1789240000000 } from './0013-recovery.ts';
import { Franking1789250000000 } from './0014-franking.ts';
import { Ephemeral1789260000000 } from './0015-ephemeral.ts';
import { DisclosureOutlives1789270000000 } from './0016-disclosure-outlives.ts';

/**
 * Every migration. Appending is the only correct edit.
 *
 * The ORDER comes from the timestamp each class name ends with, not from this array — TypeORM
 * sorts by it and refuses a class without one. The array is registration, and it is explicit
 * rather than a glob so a renamed migration fails `azeroth check` instead of silently vanishing
 * from the run.
 */
export const migrations: (new () => MigrationInterface)[] = [
    ReferenceCatalogue1789138458214,
    Identity1789139000000,
    Social1789147000000,
    Chat1789148500000,
    Groups1789160000000,
    Tables1789170000000,
    DropFairness1789180000000,
    Notifications1789190000000,
    Devices1789200000000,
    Attestation1789210000000,
    DropDemo1789220000000,
    Sealing1789230000000,
    Recovery1789240000000,
    Franking1789250000000,
    Ephemeral1789260000000,
    DisclosureOutlives1789270000000
];
