#!/bin/bash
# Healthy only once the wave login works over TCP and the seed procedure answers.
out=$(SQLCMDPASSWORD=sql-secret /opt/mssql-tools18/bin/sqlcmd -S 127.0.0.1 -U wave -d wave -C -b -h -1 -W \
  -Q "SET NOCOUNT ON; DECLARE @total int, @label nvarchar(16); EXEC dbo.wave_add @a = 2, @b = 3, @total = @total OUTPUT, @label = @label OUTPUT; SELECT CONCAT(@total, '|', @label);") || exit 1
[ "$out" = "5|sum" ]
