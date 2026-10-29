#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [ "$(id -u)" != 0 ]; then echo 'Run this installer as root.' >&2; exit 1; fi
export MEET_RECORDER_TAG="$(git rev-parse HEAD)"
# Pin a suitable host limit once; retain explicitly configured limits on upgrades.
if ! grep -q '^RECORDER_CPUS=' .env; then
  recorder_cpus=$(nproc)
  if (( recorder_cpus > 2 )); then recorder_cpus=2; fi
  printf '\nRECORDER_CPUS=%s\n' "$recorder_cpus" >> .env
fi
# Do not replace a recorder while a real lesson may be using it.
live="$(docker compose --env-file .env -f deploy/compose.yaml exec -T mysql sh -c 'MYSQL_PWD="$(cat /run/secrets/mysql_password)" mysql -h 127.0.0.1 -u meet -D meet -Nse "SELECT COUNT(*) FROM meetings WHERE status=\"live\""' </dev/null)"
if [ "$live" != 0 ]; then echo 'A lesson is live. Finish it before installing/upgrading the server recorder.' >&2; exit 1; fi
docker compose --env-file .env -f deploy/recorder.compose.yaml build
docker compose --env-file .env -f deploy/recorder.compose.yaml up -d --no-build
echo 'Server recorder started. Configure R2 privately in central administration. Recordings start automatically for live lessons with recording enabled.'
