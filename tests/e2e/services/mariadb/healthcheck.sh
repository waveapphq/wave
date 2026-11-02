#!/bin/sh
# Healthy only once the wave user logs in over verified TLS (MariaDB starts
# without TLS when it cannot load the files) and the seed procedure answers.
out=$(mariadb -h 127.0.0.1 -u wave -psql-secret -D wave -N -B \
  --ssl-ca=/etc/mysql/tls/ca.pem --ssl-verify-server-cert \
  -e "CALL wave_add(2, 3, @total, @label); SELECT CONCAT(@total, '|', @label)") || exit 1
[ "$out" = "5|sum" ]
