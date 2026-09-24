import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { chromium } from 'playwright';

function cachedChromium()
{
    const home = process.env.LOCALAPPDATA ?? process.env.HOME ?? '';
    const cache = process.env.PLAYWRIGHT_BROWSERS_PATH ?? join(home, 'ms-playwright');
    if (!existsSync(cache))
    {
        return undefined;
    }
    const builds = readdirSync(cache).filter((name) => /^chromium-\d+$/.test(name))
        .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
    for (const build of builds)
    {
        for (const relative of ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe', 'chrome-linux/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium'])
        {
            const candidate = join(cache, build, relative);
            if (existsSync(candidate))
            {
                return candidate;
            }
        }
    }
    return undefined;
}

export function launchChrome(options = {})
{
    const executablePath = process.env.QA_CHROME ?? cachedChromium();
    return chromium.launch({ ...options, ...(executablePath === undefined ? {} : { executablePath }) });
}
