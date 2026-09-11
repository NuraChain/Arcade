import { defineConfig, mergeConfig } from 'vitest/config';

import base from './vitest.config.ts';

// The one suite that binds a port, kept out of `npm test` and behind its own config rather than
// behind an environment variable the caller has to remember. `TEST_DATABASE_URL` is a variable
// because it names something outside the repository; a socket test needs nothing but permission,
// so the permission is a file.
//
// `--no-file-parallelism` because two files that each bind a listener on the same machine is
// exactly the kind of race `npm run test:shuffle` exists to catch elsewhere, not to create here.
export default mergeConfig(base, defineConfig({
    test:
    {
        include: ['tests/realtime.socket.spec.ts'],
        fileParallelism: false,
        env:
        {
            TEST_WS: '1'
        }
    }
}));
