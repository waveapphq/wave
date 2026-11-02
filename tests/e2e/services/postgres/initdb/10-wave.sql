-- wave owns its database, so it creates tables in `public` without superuser rights.
CREATE ROLE wave LOGIN PASSWORD 'sql-secret';
CREATE DATABASE wave OWNER wave;

\connect wave wave

CREATE PROCEDURE wave_add(a integer, b integer, OUT total integer, OUT label text)
LANGUAGE plpgsql
AS $$
BEGIN
  total := a + b;
  label := 'sum';
END
$$;
