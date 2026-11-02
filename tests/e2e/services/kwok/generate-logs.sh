#!/bin/sh
# Writes the one log fixture whose timestamps cannot be checked in: 6 lines stamped a
# year before container start and 4 stamped in the three minutes before it, so a
# 30-day sinceSeconds window is a real subset filter for any container uptime under
# 30 days. sinceSeconds runs against the server clock, so past that the 4 fresh lines
# age out too; the 6 archived lines stay out until 335 days of uptime.
# Every other log file under logs/ is static.

set -e

TARGET=/wave/logs/recent.log
NOW=$(date -u +%s)
ARCHIVED=$((NOW - 31536000))

stamp() {
  date -u -d "@$1" +%Y-%m-%dT%H:%M:%S.000000005Z
}

: > "$TARGET"

i=1
while [ "$i" -le 6 ]; do
  echo "$(stamp $((ARCHIVED + i - 1))) stdout F recent: archived line $i" >> "$TARGET"
  i=$((i + 1))
done

i=1
for back in 180 120 60 0; do
  echo "$(stamp $((NOW - back))) stdout F recent: fresh line $i" >> "$TARGET"
  i=$((i + 1))
done
