import { describe, expect, it } from 'vitest';

import { agentOf } from '../src/domains/admin/agent.ts';

const AGENTS: [string, string, { browser?: string; system?: string }][] = [
    ['Chrome on Windows', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36', { browser: 'Chrome', system: 'Windows' }],
    ['Edge on Windows', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0', { browser: 'Edge', system: 'Windows' }],
    ['Opera on Windows', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 OPR/124.0.0.0', { browser: 'Opera', system: 'Windows' }],
    ['Firefox on a Mac', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:144.0) Gecko/20100101 Firefox/144.0', { browser: 'Firefox', system: 'macOS' }],
    ['Safari on a Mac', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15', { browser: 'Safari', system: 'macOS' }],
    ['Safari on an iPhone', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1', { browser: 'Safari', system: 'iOS' }],
    ['Chrome on an iPhone', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.7390.41 Mobile/15E148 Safari/604.1', { browser: 'Chrome', system: 'iOS' }],
    ['Firefox on an iPhone', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/144.0 Mobile/15E148 Safari/605.1.15', { browser: 'Firefox', system: 'iOS' }],
    ['Chrome on Android', 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36', { browser: 'Chrome', system: 'Android' }],
    ['Samsung Internet', 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36', { browser: 'Samsung Internet', system: 'Android' }],
    ['Firefox on Linux', 'Mozilla/5.0 (X11; Linux x86_64; rv:144.0) Gecko/20100101 Firefox/144.0', { browser: 'Firefox', system: 'Linux' }],
    ['Chrome on a Chromebook', 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36', { browser: 'Chrome', system: 'ChromeOS' }],
    ['a headless Chrome', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/141.0.0.0 Safari/537.36', { browser: 'Chrome', system: 'Windows' }],
    ['a script', 'node', {}],
    ['nothing at all', '', {}]
];

describe('the browser a session was opened in', () =>
{
    it('names the browser and the system a person would recognise, and nothing for an agent it does not know', () =>
    {
        for (const [name, agent, expected] of AGENTS)
        {
            expect(agentOf(agent), name).toEqual(expected);
        }
    });
});
