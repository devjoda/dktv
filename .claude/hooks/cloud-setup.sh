#!/bin/bash
# Installs the dependencies when a cloud session starts. Does nothing elsewhere.
if [ "$CLAUDE_CODE_REMOTE" != "true" ]; then
    exit 0
fi
cd "$CLAUDE_PROJECT_DIR" || exit 0

git config user.name devjoda
git config user.email dev.joda@proton.me

# Only when package-lock.json changed since the last install
if [ ! -f worker/node_modules/.package-lock.json ] || [ worker/package-lock.json -nt worker/node_modules/.package-lock.json ]; then
    (cd worker && npm ci --no-audit --no-fund) || echo "npm ci failed" >&2
fi
uv sync --quiet || echo "uv sync failed" >&2
exit 0
