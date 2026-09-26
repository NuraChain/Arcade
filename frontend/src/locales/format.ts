export interface PluralForms
{
    zero?: string;
    one?: string;
    two?: string;
    few?: string;
    many?: string;
    other: string;
}

export type Message = string | PluralForms;

export type MessageVars = Record<string, string | number>;

const PLACEHOLDER = /\{([a-zA-Z0-9_]+)\}/g;

export function interpolate(template: string, vars: MessageVars | undefined, formatNumber: (value: number) => string): string
{
    if (vars === undefined)
    {
        return template;
    }
    return template.replace(PLACEHOLDER, (whole, name: string) =>
    {
        const value = vars[name];
        if (value === undefined)
        {
            return whole;
        }
        return typeof value === 'number' ? formatNumber(value) : value;
    });
}

export function selectForm(forms: PluralForms, count: number, rules: Intl.PluralRules): string
{
    const category = rules.select(count) as keyof PluralForms;
    return forms[category] ?? forms.other;
}

export function resolveMessage(message: Message, vars: MessageVars | undefined, rules: Intl.PluralRules): string
{
    if (typeof message === 'string')
    {
        return message;
    }
    const count = vars?.count;
    return selectForm(message, typeof count === 'number' ? count : Number(count ?? 0), rules);
}

export function messageText(message: Message): string
{
    return typeof message === 'string' ? message : message.other;
}

const MINUTE = 60000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

export function relativeUnit(diffMs: number): { unit: Intl.RelativeTimeFormatUnit; value: number }
{
    const size = Math.abs(diffMs);
    const sign = diffMs < 0 ? -1 : 1;
    if (size < MINUTE)
    {
        return { unit: 'second', value: sign * Math.round(size / 1000) };
    }
    if (size < HOUR)
    {
        return { unit: 'minute', value: sign * Math.round(size / MINUTE) };
    }
    if (size < DAY)
    {
        return { unit: 'hour', value: sign * Math.round(size / HOUR) };
    }
    if (size < WEEK)
    {
        return { unit: 'day', value: sign * Math.round(size / DAY) };
    }
    if (size < MONTH)
    {
        return { unit: 'week', value: sign * Math.round(size / WEEK) };
    }
    if (size < YEAR)
    {
        return { unit: 'month', value: sign * Math.round(size / MONTH) };
    }
    return { unit: 'year', value: sign * Math.round(size / YEAR) };
}
