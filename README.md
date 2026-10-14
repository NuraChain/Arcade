# Nura Arcade

A place to play Ludo, Hokm, Backgammon and Poker with friends, or with anyone looking for a game.
Make friends, start groups and chat privately, in English or Persian.

## Running it on a server

It needs Node 24.11 or newer, PostgreSQL with the `citext` and `pgcrypto` extensions available,
and nginx (or another proxy) in front for TLS. One process serves the api, the realtime
connection and the pages.

1. Clone the repository and run `npm ci` at its root.
2. Copy `.env.example` to `.env` and fill it in. Every name has to be present; an empty value
   switches an optional feature off (push notifications, STUN and TURN for voice, the chain, the explorer,
   the admin). For production:
   - `NODE_ENV=production`, `SERVE_PAGES=true`, `DATABASE_SYNC=false`;
   - `DATABASE_URL` pointing at an empty database;
   - `SESSION_SECRET`: a long random string, such as the output of `openssl rand -hex 32`;
   - `PUBLIC_ORIGIN` and `VITE_PUBLIC_ORIGIN`: the address people use, such as
     `https://play.example.com` (it is the site in every sign-in message, the realtime origin
     check and the cookie's site);
   - `PORT`: the local port the proxy forwards to. The server listens on `127.0.0.1` only.
3. `npm run build`
4. `npm run schema:sync` builds the database from the entities. Run it before the first start and
   after every update that changes them.
5. `sudo scripts/service-install.sh` installs a systemd service, and refuses while the build or a
   filled-in `.env` is missing. Then `sudo scripts/service-start.sh`; the logs are in `.logs/`.
6. Point the proxy at `http://127.0.0.1:$PORT`, upgrading the WebSocket on `/ws`:

   ```nginx
   map $http_upgrade $connection_upgrade { default upgrade; '' close; }

   server {
       server_name play.example.com;

       location / {
           proxy_pass http://127.0.0.1:3200;
           proxy_http_version 1.1;
           proxy_set_header Host $host;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection $connection_upgrade;
       }
   }
   ```

To update: `git pull`, `npm ci`, `npm run build`, `npm run schema:sync`, then
`sudo scripts/service-restart.sh`.

A production database holds nothing made up. The server writes the games, their rules and the
achievements on every start; every person, table, message and score is made by the people using
it. The test accounts the project uses are written only in development.

Licensed under the [MIT License](license).
