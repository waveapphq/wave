#!/bin/sh
# Healthy only once the wave login works over TCP and the seed procedure answers.
out=$(PGPASSWORD=sql-secret psql -h 127.0.0.1 -U wave -d wave -tA \
  -c "CALL wave_add(a => 2, b => 3, total => NULL, label => NULL)") || exit 1
[ "$out" = "5|sum" ]
