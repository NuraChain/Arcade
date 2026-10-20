import type { Stage } from './stage.ts';

export interface Confetti
{
    host: HTMLElement;
    tones: readonly string[];
    layer: number;
    count?: number;
}

export const CONFETTI = 28;

const PAPER = ['#F6F1E6', '#FFFFFF'];

export function celebrate(stage: Stage, options: Confetti)
{
    const flecks: HTMLElement[] = [];
    const count = options.count ?? CONFETTI;

    if (stage.quiet() || options.tones.length === 0)
    {
        return flecks;
    }

    for (let index = 0; index < count; index += 1)
    {
        const angle = (index / count) * Math.PI * 2 + (index % 5) * 0.11;
        const reach = 26 + (index % 7) * 3.5;
        const fleck = document.createElement('span');

        fleck.className = 'absolute inset-s-0 inset-bs-0 inline-[1.4cqi] block-[2.6cqi] mbs-[-1.3cqi] ms-[-0.7cqi] rounded-[1px]';
        fleck.style.zIndex = String(options.layer);
        fleck.style.background = index % 3 === 0 ? options.tones[(index / 3) % options.tones.length] : PAPER[index % 3 - 1];
        options.host.append(fleck);
        flecks.push(fleck);

        void stage.animate(fleck, [
            { translate: '50cqi 50cqi', rotate: `${ index * 37 }deg`, opacity: 1 },
            {
                translate: `${ (50 + Math.cos(angle) * reach).toFixed(3) }cqi ${ (58 + Math.sin(angle) * reach).toFixed(3) }cqi`,
                rotate: `${ index * 37 + 540 }deg`,
                opacity: 0
            }
        ], { duration: 1100 + (index % 6) * 90, easing: 'cubic-bezier(0.22, 0.61, 0.36, 1)', fill: 'both' }).done.then(() => fleck.remove());
    }

    return flecks;
}
