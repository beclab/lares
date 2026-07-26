#!/bin/sh
set -eu

: "${PI_CODING_AGENT_DIR:=/data/pi/agent}"
: "${LARES_WORKSPACE:=/data/workspace}"
: "${HOME:=/data/home}"
export HOME

mkdir -p "$PI_CODING_AGENT_DIR" "$LARES_WORKSPACE" "$HOME"

# Olares mounts /data from host storage, so repositories there are usually owned
# by a different uid than the one this container runs as. Without this, every
# git tool pi shells out to fails with "dubious ownership".
git config --global --add safe.directory '*' 2>/dev/null || true

exec node /app/packages/server/dist/index.js "$@"
