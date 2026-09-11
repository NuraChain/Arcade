import { createStore, createSignal, type Getter } from 'azerothjs';

import { dataset } from '../data/mock/index.ts';
import type { GameId } from '../data/games.ts';
import { GAMES } from '../data/games.ts';
import { createRandom, hashSeed } from '../lib/random.ts';
import { runtime } from '../lib/runtime.ts';

export type PresenceState = 'online' | 'away' | 'offline' | 'playing';

export interface Presence
{
    state: PresenceState;
    game: GameId | null;
    since: number;
}

export const PRESENCE_TICK_MS = 4000;

const OFFLINE: Presence = { state: 'offline', game: null, since: 0 };

function seedPresence(seed: number, now: number): Map<string, Presence>
{
    const map = new Map<string, Presence>();
    for (const person of dataset().people)
    {
        const random = createRandom(hashSeed(seed, 'presence', person.id));
        const roll = random.next();
        const state: PresenceState = person.demo || roll < 0.42 ? 'online' : (roll < 0.58 ? 'playing' : (roll < 0.72 ? 'away' : 'offline'));
        map.set(person.id, {
            state,
            game: state === 'playing' ? (random.chance(0.7) ? person.favourite : random.pick(GAMES).id) : null,
            since: now - random.int(1, 90) * 60000
        });
    }
    return map;
}

export interface PresenceApi
{
    of(id: string): Presence;
    isOnline(id: string): boolean;
    onlineCount: Getter<number>;
    online(ids: readonly string[]): string[];
    setMine(id: string, state: PresenceState, game?: GameId | null): void;
    start(): () => void;
    stop(): void;
    reset(): void;
}

export const usePresence = createStore((): PresenceApi =>
{
    const [map, setMap] = createSignal<Map<string, Presence>>(seedPresence(runtime().seed, runtime().clock.now()));
    let tick = 0;
    let stop: (() => void) | null = null;

    const drift = (): void =>
    {
        tick += 1;
        const random = createRandom(hashSeed(runtime().seed, 'drift', tick));
        const people = dataset().people.filter((person) => !person.demo);
        const next = new Map(map());
        const flips = random.int(1, 2);
        for (let index = 0; index < flips; index += 1)
        {
            const person = random.pick(people);
            const current = next.get(person.id) ?? OFFLINE;
            const roll = random.next();
            const state: PresenceState = current.state === 'offline'
                ? (roll < 0.6 ? 'online' : 'offline')
                : (roll < 0.25 ? 'playing' : (roll < 0.5 ? 'online' : (roll < 0.7 ? 'away' : 'offline')));
            next.set(person.id, {
                state,
                game: state === 'playing' ? person.favourite : null,
                since: runtime().clock.now()
            });
        }
        setMap(next);
    };

    return {
        of: (id) => map().get(id) ?? OFFLINE,
        isOnline: (id) =>
        {
            const state = (map().get(id) ?? OFFLINE).state;
            return state === 'online' || state === 'playing';
        },
        onlineCount: () =>
        {
            let count = 0;
            for (const presence of map().values())
            {
                if (presence.state === 'online' || presence.state === 'playing')
                {
                    count += 1;
                }
            }
            return count;
        },
        online: (ids) => ids.filter((id) =>
        {
            const state = (map().get(id) ?? OFFLINE).state;
            return state === 'online' || state === 'playing';
        }),
        setMine: (id, state, game) =>
        {
            const next = new Map(map());
            next.set(id, { state, game: game ?? null, since: runtime().clock.now() });
            setMap(next);
        },

        start()
        {
            if (stop === null)
            {
                const cancel = runtime().clock.every(PRESENCE_TICK_MS, drift);
                stop = () =>
                {
                    cancel();
                    stop = null;
                };
            }
            return stop;
        },

        stop()
        {
            stop?.();
        },

        reset()
        {
            stop?.();
            tick = 0;
            setMap(seedPresence(runtime().seed, runtime().clock.now()));
        }
    };
});
