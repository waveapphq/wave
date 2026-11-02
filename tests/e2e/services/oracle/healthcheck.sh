#!/bin/bash
# Healthy only once the image's own check passes (database open, setup scripts
# done) and the wave user logs in over TCP and the seed procedure answers.
healthcheck.sh >/dev/null 2>&1 || exit 1
out=$(sqlplus -s -L 'wave/"sql-secret"@//127.0.0.1:1521/FREEPDB1' <<'SQL'
SET HEADING OFF FEEDBACK OFF PAGESIZE 0 VERIFY OFF
VARIABLE total NUMBER
VARIABLE label VARCHAR2(16)
EXEC wave_add(a => 2, b => 3, total => :total, label => :label)
SELECT :total || '|' || :label FROM dual;
EXIT
SQL
) || exit 1
[ "$(echo "$out" | tr -d '[:space:]')" = "5|sum" ]
