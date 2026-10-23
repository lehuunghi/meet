#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
umask 077
mkdir -p secrets
for name in mysql_password mysql_root_password redis_password demo_password; do
  if [ ! -e "secrets/$name" ]; then openssl rand -hex 24 > "secrets/$name"; fi
done
if [ ! -e secrets/mysql_dsn ]; then
  printf 'meet:%s@tcp(mysql:3306)/meet?parseTime=true&loc=UTC&charset=utf8mb4' "$(cat secrets/mysql_password)" > secrets/mysql_dsn
fi
if [ ! -e secrets/redis_url ]; then
  printf 'redis://:%s@redis:6379/0' "$(cat secrets/redis_password)" > secrets/redis_url
fi
for name in cf_sfu_app_id cf_sfu_secret cf_turn_keys r2_account_id r2_access_key_id r2_secret_access_key r2_bucket; do
  if [ ! -e "secrets/$name" ]; then : > "secrets/$name"; fi
done
# API runs as uid 10001. Use a dedicated group rather than world-readable secrets.
if [ "$(id -u)" = 0 ]; then chown -R 10001:10001 secrets; else echo 'Before Compose: sudo chown -R 10001:10001 secrets'; fi
chmod 700 secrets
chmod 600 secrets/*
echo 'Secret files prepared. Configure Cloudflare files before enabling media.'
