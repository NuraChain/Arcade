# Nura Arcade

A place to play Ludo, Hokm, Backgammon and Poker with friends, or with anyone looking for a game.
Make friends, start groups and chat privately, in English or Persian.

## Running it on a server

It needs Node 24.11 or newer, PostgreSQL with the `citext` and `pgcrypto` extensions available,
and nginx (or another proxy) in front for TLS. One process serves the api, the realtime
connection and the pages. Run one such process for each database: who is online, quick play's
picture of who is waiting, voice calls and every live update are kept by the process that holds a
player's connection, so players on two servers cannot find, hear or reach each other, and each
server would stand up the other's waiting players. A server that finds another one using its
database says so in its log.

1. As an ordinary account, not root (`sudo adduser nura`, say), clone the repository and run
   `npm ci` at its root. The service runs as whoever owns the clone.
2. Copy `.env.example` to `.env`. Every name in it must stay written; fill in these three:
   - `DATABASE_URL` pointing at an empty database;
   - `SESSION_SECRET`: a long random string, such as the output of `openssl rand -hex 32`;
   - `PUBLIC_ORIGIN`: the address people use, such as `https://play.example.com` (it is the site
     in every sign-in message, the realtime origin check and the cookie's site).

   The server refuses to start with a `SESSION_SECRET` shorter than 32 characters, or a
   `PUBLIC_ORIGIN` that carries a path or an ending slash, or is plain http anywhere but this
   machine, and says which. The optional features (push notifications, TURN for voice,
   the chain, the admin) stay off while their values are empty, and a name taken out of the file
   stops the server, which names it. It listens on `HOST` (`127.0.0.1` in the example) at `PORT`
   (4900) for the proxy. The server runs as production whenever it is not started by `npm run dev`.
3. `npm run build`
4. `npm run schema:sync` builds the database from the entities. Run it before the first start and
   after every update that changes them. It makes the database match the entities exactly, so a
   column an entity no longer has is dropped with everything in it: once the database holds
   anything, take a dump first (below).
5. `npm start` runs the server; keep it running with whatever supervises processes on the
   machine. The logs are in `.logs/`.
6. Point the proxy at `http://127.0.0.1:4900` (or the `PORT` you wrote), upgrading the WebSocket
   on `/ws`:

   ```nginx
   map $http_upgrade $connection_upgrade { default upgrade; '' close; }

   server {
       server_name play.example.com;

       location / {
           proxy_pass http://127.0.0.1:4900;
           proxy_http_version 1.1;
           proxy_set_header Host $host;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection $connection_upgrade;
       }
   }
   ```

To update: `git pull`, `npm ci`, `npm run build`, `pg_dump` the database, `npm run schema:sync`,
then restart the server.

Back up the database, because it is the only thing here that cannot be built again: every
account, friendship, table, game, sealed message and uploaded picture lives in it. The build, the
games, their rules and the achievements come back from the repository. `pg_dump` it on a schedule
and keep the copies somewhere else; to restore, create an empty database, load the dump with
`psql`, and start the service. Keep the `.env` beside the dumps as well: under a new
`SESSION_SECRET` no message sent before the change can be reported any more.

A production database holds nothing made up. The server writes the games, their rules and the
achievements on every start; every person, table, message and score is made by the people using
it. The test accounts the project uses are written only in development.

Licensed under the [MIT License](license).
