#!/bin/sh
# Starts the production-style server (serves client/dist) for local testing.
export PATH="/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:$PATH"
export HOST_PIN="${HOST_PIN:-1234}"
export DATA_FILE="${DATA_FILE:-/tmp/funded-test/game.json}"
cd "$(dirname "$0")/.."
exec npx tsx server/src/index.ts
