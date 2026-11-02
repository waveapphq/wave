-- Runs as SYSDBA in the root container at first start, after APP_USER exists.
WHENEVER SQLERROR EXIT SQL.SQLCODE
ALTER SESSION SET CONTAINER = FREEPDB1;

CREATE OR REPLACE PROCEDURE wave.wave_add(a IN NUMBER, b IN NUMBER, total OUT NUMBER, label OUT VARCHAR2)
AS
BEGIN
  total := a + b;
  label := 'sum';
END;
/
