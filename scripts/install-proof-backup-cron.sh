#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${1:-/var/www/key-sphincs-mint}"
LOG_FILE="/var/log/key-proof-backup.log"
CRON_LINE="17 * * * * cd ${APP_DIR} && /usr/bin/env npm run backup:proofs >> ${LOG_FILE} 2>&1"

tmp="$(mktemp)"
crontab -l 2>/dev/null | grep -v "npm run backup:proofs" > "$tmp" || true
echo "$CRON_LINE" >> "$tmp"
crontab "$tmp"
rm -f "$tmp"

echo "Installed hourly proof backup cron:"
echo "$CRON_LINE"
