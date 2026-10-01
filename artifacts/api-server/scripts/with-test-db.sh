#!/usr/bin/env bash
#
# Run a command against a throwaway Postgres.
#
# Starts a cluster in a temp directory on a non-default port, applies the
# schema, exports TEST_DATABASE_URL, runs whatever it was given, and tears the
# cluster down afterwards — pass or fail.
#
#   ./scripts/with-test-db.sh pnpm test:api
#
# TEST_DATABASE_URL is deliberately a different variable from DATABASE_URL so
# the tenant-isolation tests can never be pointed at anything real. If one is
# already set (a CI service container, say), this script gets out of the way
# and just runs the command.
set -euo pipefail

if [ -n "${TEST_DATABASE_URL:-}" ]; then
  echo "Using the TEST_DATABASE_URL already set."
  exec "$@"
fi

PG_BIN="${PG_BIN:-/usr/lib/postgresql/16/bin}"
if [ ! -x "$PG_BIN/initdb" ]; then
  echo "No Postgres found at $PG_BIN." >&2
  echo "Install postgresql-16, or set PG_BIN, or set TEST_DATABASE_URL to a throwaway database." >&2
  exit 1
fi

PORT="${TEST_PG_PORT:-55432}"
DATA_DIR="$(mktemp -d -t fhtestpg-XXXXXX)"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

# initdb refuses to run as root, so hand the directory to the postgres user
# when we happen to be root (containers usually are).
RUN_AS=""
if [ "$(id -u)" = "0" ] && id postgres >/dev/null 2>&1; then
  RUN_AS="postgres"
  chown -R postgres:postgres "$DATA_DIR"
fi

run_pg() {
  if [ -n "$RUN_AS" ]; then su "$RUN_AS" -c "$*"; else bash -c "$*"; fi
}

cleanup() {
  run_pg "$PG_BIN/pg_ctl -D $DATA_DIR/data -m immediate stop" >/dev/null 2>&1 || true
  rm -rf "$DATA_DIR"
}
trap cleanup EXIT

echo "Starting a throwaway Postgres on port $PORT…"
run_pg "$PG_BIN/initdb -D $DATA_DIR/data -U postgres --auth=trust" >/dev/null
run_pg "$PG_BIN/pg_ctl -D $DATA_DIR/data -o '-p $PORT -k $DATA_DIR' -l $DATA_DIR/log start" >/dev/null

export TEST_DATABASE_URL="postgres://postgres@127.0.0.1:$PORT/familyhub_test"
run_pg "$PG_BIN/createdb -h 127.0.0.1 -p $PORT -U postgres familyhub_test" >/dev/null

echo "Applying the schema…"
( cd "$REPO_ROOT/lib/db" && DATABASE_URL="$TEST_DATABASE_URL" npx drizzle-kit push --force --config ./drizzle.config.ts >/dev/null )

echo "Running: $*"
"$@"
