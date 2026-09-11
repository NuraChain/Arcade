import { vi } from 'vitest';

vi.mock('../src/api.ts', async () => await import('./fake-api.ts'));
