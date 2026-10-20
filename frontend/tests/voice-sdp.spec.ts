import { describe, it, expect } from 'vitest';

import { OPUS_CEILING, tuneOpus } from '../src/services/voice.sdp.ts';

const OFFER = [
    'v=0',
    'm=audio 9 UDP/TLS/RTP/SAVPF 111 63 0',
    'a=rtpmap:111 opus/48000/2',
    'a=rtcp-fb:111 transport-cc',
    'a=fmtp:111 minptime=10;useinbandfec=1',
    'a=rtpmap:63 red/48000/2',
    'a=fmtp:63 111/111',
    'a=rtpmap:0 PCMU/8000',
    ''
].join('\r\n');

describe('the description of a line, as it is taken in', () =>
{
    it('lets Opus be sent up to the highest quality offered, in mono, with what the line already said kept', () =>
    {
        const tuned = tuneOpus(OFFER);

        expect(tuned).toContain(`a=fmtp:111 minptime=10;useinbandfec=1;maxaveragebitrate=${ OPUS_CEILING };stereo=0;sprop-stereo=0;usedtx=0`);
        expect(tuned).toContain('a=fmtp:63 111/111');
        expect(tuned.split('\r\n')).toHaveLength(OFFER.split('\r\n').length);
    });

    it('says it for an Opus that came with nothing said about it', () =>
    {
        const bare = OFFER.replace('a=fmtp:111 minptime=10;useinbandfec=1\r\n', '');
        const tuned = tuneOpus(bare, 64_000);

        expect(tuned).toContain('a=rtpmap:111 opus/48000/2\r\na=fmtp:111 maxaveragebitrate=64000;useinbandfec=1;stereo=0;sprop-stereo=0;usedtx=0');
    });

    it('leaves a description with no Opus in it as it came, line endings and all', () =>
    {
        const plain = 'v=0\na=rtpmap:0 PCMU/8000\n';

        expect(tuneOpus(plain)).toBe(plain);
        expect(tuneOpus(OFFER.replace(/\r\n/g, '\n'))).not.toContain('\r');
    });
});
