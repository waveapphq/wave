-- The seed procedure the Call procedure leg reads its out values from.
CREATE PROCEDURE wave.wave_add(IN a INT, IN b INT, OUT total INT, OUT label VARCHAR(16))
  SQL SECURITY INVOKER
  SELECT a + b, 'sum' INTO total, label;

-- The program name a client sends is read back from this table.
GRANT SELECT ON performance_schema.session_connect_attrs TO 'wave'@'%';
