import { vi } from 'vitest';

import { createFakeSource } from './fake-realtime.ts';
import { setRealtimeSource } from '../src/stores/realtime.store.ts';

vi.mock('../src/api.ts', async () => await import('./fake-api.ts'));

setRealtimeSource(createFakeSource());
