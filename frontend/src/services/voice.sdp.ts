export const OPUS_CEILING = 96_000;

export function tuneOpus(sdp: string, ceiling = OPUS_CEILING)
{
    const lines = sdp.split(/\r\n|\n/);
    const types = new Set<string>();

    for (const line of lines)
    {
        const found = /^a=rtpmap:(\d+) opus\/48000/i.exec(line);

        if (found !== null)
        {
            types.add(found[1]);
        }
    }

    if (types.size === 0)
    {
        return sdp;
    }

    const wanted: Record<string, string> = { maxaveragebitrate: String(ceiling), useinbandfec: '1', stereo: '0', 'sprop-stereo': '0', usedtx: '0' };
    const tuned: string[] = [];

    for (const line of lines)
    {
        const fmtp = /^a=fmtp:(\d+) (.*)$/.exec(line);

        if (fmtp !== null && types.has(fmtp[1]))
        {
            const params = new Map(fmtp[2].split(';').map((one) => one.trim()).filter((one) => one !== '').map((one) =>
            {
                const at = one.indexOf('=');

                return at === -1 ? [one, ''] : [one.slice(0, at), one.slice(at + 1)];
            }));

            for (const [key, value] of Object.entries(wanted))
            {
                params.set(key, value);
            }

            tuned.push(`a=fmtp:${ fmtp[1] } ${ [...params].map(([key, value]) => (value === '' ? key : `${ key }=${ value }`)).join(';') }`);
            continue;
        }

        tuned.push(line);

        const rtpmap = /^a=rtpmap:(\d+) opus\/48000/i.exec(line);

        if (rtpmap !== null && !lines.some((other) => other.startsWith(`a=fmtp:${ rtpmap[1] } `)))
        {
            tuned.push(`a=fmtp:${ rtpmap[1] } ${ Object.entries(wanted).map(([key, value]) => `${ key }=${ value }`).join(';') }`);
        }
    }

    return tuned.join(sdp.includes('\r\n') ? '\r\n' : '\n');
}
