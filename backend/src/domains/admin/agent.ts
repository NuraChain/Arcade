const BROWSERS: readonly (readonly [RegExp, string])[] = [
    [/\bEdg(?:e|A|iOS)?\//, 'Edge'],
    [/\b(?:OPR|OPiOS|Opera)\//, 'Opera'],
    [/\bSamsungBrowser\//, 'Samsung Internet'],
    [/\b(?:Firefox|FxiOS)\//, 'Firefox'],
    [/\b(?:HeadlessChrome|Chrome|CriOS|Chromium)\//, 'Chrome'],
    [/\bVersion\/[\d.]+.*\bSafari\//, 'Safari']
];

const SYSTEMS: readonly (readonly [RegExp, string])[] = [
    [/\b(?:iPhone|iPad|iPod)\b/, 'iOS'],
    [/\bAndroid\b/, 'Android'],
    [/\bCrOS\b/, 'ChromeOS'],
    [/\bWindows\b/, 'Windows'],
    [/\bMac OS X\b|\bMacintosh\b/, 'macOS'],
    [/\bLinux\b/, 'Linux']
];

const named = (agent: string, table: readonly (readonly [RegExp, string])[]) => table.find(([test]) => test.test(agent))?.[1];

export function agentOf(agent: string)
{
    const browser = named(agent, BROWSERS);
    const system = named(agent, SYSTEMS);

    return {
        ...(browser === undefined ? {} : { browser }),
        ...(system === undefined ? {} : { system })
    };
}
