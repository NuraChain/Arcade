export const NAMES_MAX = 50;

export const PEOPLE_FOUND_MAX = 24;

export const SEARCH_FROM = 2;

export const LETTERS_TYPED = 'يىكأإآۀ';

export const LETTERS_READ = 'ییکاااه';

export function searchNeedle(asked: string)
{
    return [...asked.trim().toLowerCase().replace(/\s+/g, ' ')]
        .map((letter) => LETTERS_READ[LETTERS_TYPED.indexOf(letter)] ?? letter)
        .join('');
}
