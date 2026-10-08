import { HttpError } from '@azerothjs/http';

import { noInvitee } from '../table/service.ts';
import type { PartyWhy } from './parties.ts';
import { PARTY_REFUSALS, type PartyRefusal } from './rules.ts';

const SAYS: Record<PartyRefusal, string> = {
    'party-missing': 'No team-up there.',
    'in-party': 'You are already in a team. Leave it first.',
    'not-team-game': 'That game is not played in teams.',
    'party-cooldown': 'Wait a moment before asking them again.'
};

export const partyRefusal = (word: PartyRefusal) => new HttpError(PARTY_REFUSALS[word], SAYS[word], { code: word });

export const partyRefused = (why: PartyWhy) => (why === 'no-invitee' ? noInvitee() : partyRefusal(why));
