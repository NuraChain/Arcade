import { render } from 'azerothjs';

import { useParty } from '../../stores/party.store.ts';
import PartyInvite from './party-invite.component.azeroth';

export function begin()
{
    const stop = useParty().start();
    const host = document.createElement('div');

    document.body.append(host);
    render(() => PartyInvite({}), host);

    return () =>
    {
        stop();
        render(() => [], host);
        host.remove();
    };
}
