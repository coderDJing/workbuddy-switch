#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
exec node scripts/release-artifacts.mjs manifest "$@"
