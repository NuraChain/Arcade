#!/bin/bash

set -euo pipefail

NODE_PATH="${NODE_PATH:-$(command -v node || true)}"

if [ -z "$NODE_PATH" ]; then
  echo "error: node binary not found (set NODE_PATH to override)" >&2
  exit 1
fi

if [ "$(id -u)" -ne 0 ]; then
  echo "error: writing the unit file needs root - re-run with sudo" >&2
  exit 1
fi

SERVICE_NAME="nura-games"

# The repo root, and the server half inside it. The server IS the service: it runs the api, the
# realtime gateway and the background sweeps, and in production serves the built client itself, so
# there is only ever one unit.
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SERVICE_PATH="$ROOT/server"

# This backend COMPILES, which is the one thing that differs from the Explorer service and the one
# thing that will strand a deploy silently. `typeorm` sitting in `dependencies` is what decides it:
# the CLI carries DECORATOR_PACKAGES and the name alone flips the project from running `src/` to
# emitting `dist/`. Node's own TypeScript support is strip-only and rejects decorator syntax
# outright, so there is no way to run an `@Entity` file directly - `dist/main.js` or nothing.
SERVICE_PATH_APP="dist/main.js"

SERVICE_DIR="${SERVICE_DIR:-/etc/systemd/system}"
SERVICE_FILE="$SERVICE_DIR/${SERVICE_NAME}.service"

# Three things a missing build turns into a restart loop at 3am. Say so here instead.
if [ ! -f "$SERVICE_PATH/$SERVICE_PATH_APP" ]; then
  echo "warning: server/$SERVICE_PATH_APP is missing - run 'npm run build' before starting" >&2
fi

if [ ! -f "$ROOT/application/dist/index.html" ]; then
  echo "warning: application/dist is missing - the server would answer the api and 404 every page" >&2
fi

if [ ! -f "$ROOT/application/dist-server/entry.server.js" ]; then
  echo "warning: application/dist-server/entry.server.js is missing - there is no SSR bundle to render with" >&2
fi

if [ ! -f "$SERVICE_PATH/.env" ]; then
  echo "warning: server/.env is missing - the service would boot against the defaults" >&2
else
  # Three values decide whether this process is a SERVER or half of a development pair, and every
  # one of them is silent when wrong. `SERVE_PAGES=false` answers the api and 404s every page;
  # `PUBLIC_ORIGIN` pointing anywhere but the real origin makes the realtime gate refuse every
  # socket and makes every wallet signature a claim about somewhere else; `NODE_ENV` short of
  # production runs `syncSchema` on every boot; and a `SESSION_SECRET` that is empty is the only
  # thing standing between a cookie and a forged session.
  # Only an EXPLICIT false is worth saying anything about: absent means "serve them", because under
  # NODE_ENV=production this process is the server. Warning on absent would fire for the correct
  # configuration, which is the same noise the schema note above was fixed for.
  ! grep -q '^SERVE_PAGES=false' "$SERVICE_PATH/.env" ||
    echo "warning: SERVE_PAGES=false - this process answers the api and 404s every page unless something else serves the client" >&2

  grep -q '^PUBLIC_ORIGIN=https\?://' "$SERVICE_PATH/.env" ||
    echo "warning: PUBLIC_ORIGIN is unset - the realtime origin gate refuses every socket without it" >&2

  grep -qE '^SESSION_SECRET=.+' "$SERVICE_PATH/.env" ||
    echo "warning: SESSION_SECRET is empty - sessions cannot be signed" >&2
fi

# The schema is built from the entities, and production does it as a DELIBERATE act rather than as a
# side effect of starting - `main.ts` runs the sync only under NODE_ENV=development. A first deploy
# that skips it boots against a database with no tables, and an entity change deployed without it
# runs against the old shape.
#
# Said unconditionally rather than behind a marker file. The first version of this checked for a
# `.schema-synced` that nothing anywhere writes, so the note fired on every install - and a warning
# that always fires is one people stop reading, which is worse than not printing it.
echo "note: run 'npm run schema:sync --workspace server' before the first start, and after any entity change" >&2

# systemd does not create the directory it is told to log into.
mkdir -p "$SERVICE_PATH/logs"

echo "> Installing systemd service (${SERVICE_FILE})..."

cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=Nura Games
After=network.target postgresql.service

[Service]
RestartSec=5
Restart=always
# Without this the server runs its DEVELOPMENT path, which includes building the schema from the
# entities on every boot - a thing production does on purpose or not at all.
Environment=NODE_ENV=production
WorkingDirectory=$SERVICE_PATH
# Quoted: systemd splits ExecStart on whitespace, and an interpreter installed under a path with
# a space in it (nvm on some setups, /opt installs) would otherwise be read as two arguments.
ExecStart="$NODE_PATH" --enable-source-maps $SERVICE_PATH_APP

StandardOutput=file:$SERVICE_PATH/logs/service_output.log
StandardError=file:$SERVICE_PATH/logs/service_error.log

LimitNOFILE=1048576

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload

systemctl enable "$SERVICE_NAME"

echo "> Service Installed."
