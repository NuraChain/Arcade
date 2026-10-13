/**
 * A line a page logs because the chain's network could not be reached is not a finding about
 * the page. The server answers it on purpose (503 `chain-unreachable` from `/api/chain/`), the
 * profile pages show it with a way to ask again, and whether it happens on a given run is the
 * weather at somebody else's node. A pass about a game or a route should not be red for it and
 * should not hide it either, so it is said where it happens and then left out of the count.
 *
 * Anything else `/api/chain/` answers with is still a finding: a 500 there is a fault of ours.
 */
export function chainUnreached(event, who)
{
    const from = event.location().url ?? '';

    if (event.type() !== 'error' || !/\/api\/chain\//.test(from) || !/status of 503/.test(event.text()))
    {
        return false;
    }

    console.log(`  NOTE  ${ who } could not reach the chain's network (${ new URL(from).pathname }): not this pass's to judge`);

    return true;
}
