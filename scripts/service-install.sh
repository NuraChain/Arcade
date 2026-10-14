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
SERVICE_PATH="$ROOT/backend"

# This backend COMPILES, which is the one thing that differs from the Explorer service and the one
# thing that will strand a deploy silently. `typeorm` sitting in `dependencies` is what decides it:
# the CLI carries DECORATOR_PACKAGES and the name alone flips the project from running `src/` to
# emitting `.dist-backend/` at the repository root. Node's own TypeScript support is strip-only and
# rejects decorator syntax outright, so there is no way to run an `@Entity` file directly - the
# compiled `main.js` or nothing.
SERVICE_PATH_APP="../.dist-backend/main.js"

SERVICE_DIR="${SERVICE_DIR:-/etc/systemd/system}"
SERVICE_FILE="$SERVICE_DIR/${SERVICE_NAME}.service"

# A service installed without these restarts in a loop at 3am, or runs open. Refuse here instead.
REFUSED=0

refuse()
{
  echo "error: $1" >&2
  REFUSED=1
}

[ -f "$SERVICE_PATH/$SERVICE_PATH_APP" ] || refuse ".dist-backend/main.js is missing - run 'npm run build' first"
[ -f "$ROOT/.dist-frontend/index.html" ] || refuse ".dist-frontend is missing - run 'npm run build' first"
[ -f "$ROOT/.dist-server/entry.server.js" ] || refuse ".dist-server/entry.server.js is missing - run 'npm run build' first"

if [ ! -f "$ROOT/.env" ]; then
  refuse ".env is missing at the repository root - copy .env.example to .env and fill it in"
else
  # PUBLIC_ORIGIN is the site in every sign-in message, the realtime origin check and the cookie's
  # site at once; an empty SESSION_SECRET is the only thing between a cookie and a forged session.
  grep -q '^PUBLIC_ORIGIN=https\?://' "$ROOT/.env" ||
    refuse "PUBLIC_ORIGIN is not set to the address people use, such as https://play.example.com"

  grep -qE '^SESSION_SECRET=.+' "$ROOT/.env" ||
    refuse "SESSION_SECRET is empty - set it to a long random string, such as the output of 'openssl rand -hex 32'"

  # Only an explicit false is worth a word: this process serves the client unless told not to.
  ! grep -q '^SERVE_PAGES=false' "$ROOT/.env" ||
    echo "warning: SERVE_PAGES=false - this process answers the api and 404s every page unless something else serves the client" >&2

  ! grep -q '^DATABASE_SYNC=true' "$ROOT/.env" ||
    echo "warning: DATABASE_SYNC=true builds the schema on every start - production runs 'npm run schema:sync' on purpose instead" >&2
fi

[ "$REFUSED" -eq 0 ] || exit 1

# The schema is built from the entities, and production does it as a DELIBERATE act rather than as a
# side effect of starting - `main.ts` runs the sync only when DATABASE_SYNC=true. A first deploy
# that skips it boots against a database with no tables, and an entity change deployed without it
# runs against the old shape.
#
# Said unconditionally rather than behind a marker file. The first version of this checked for a
# `.schema-synced` that nothing anywhere writes, so the note fired on every install - and a warning
# that always fires is one people stop reading, which is worse than not printing it.
echo "note: run 'npm run schema:sync --workspace backend' before the first start, and after any entity change" >&2

# systemd does not create the directory it is told to log into.
mkdir -p "$ROOT/.logs"

echo "> Installing systemd service (${SERVICE_FILE})..."

cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=Nura Games
After=network.target postgresql.service

[Service]
RestartSec=5
Restart=always
# Without this the server runs its DEVELOPMENT path, which seeds the wallet fixtures and trusts no
# proxy. It wins over whatever .env says, because .env never overrides the process's environment.
Environment=NODE_ENV=production
WorkingDirectory=$SERVICE_PATH
# Quoted: systemd splits ExecStart on whitespace, and an interpreter installed under a path with
# a space in it (nvm on some setups, /opt installs) would otherwise be read as two arguments.
ExecStart="$NODE_PATH" --enable-source-maps $SERVICE_PATH_APP

StandardOutput=file:$ROOT/.logs/service_output.log
StandardError=file:$ROOT/.logs/service_error.log

LimitNOFILE=1048576

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload

systemctl enable "$SERVICE_NAME"

echo "> Service Installed."
