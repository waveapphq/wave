CREATE DATABASE wave;
GO
-- CHECK_POLICY OFF: the shared stack password does not meet the complexity rule.
CREATE LOGIN wave WITH PASSWORD = 'sql-secret', CHECK_POLICY = OFF, DEFAULT_DATABASE = wave;
-- Lets a session read its own encrypt_option in sys.dm_exec_connections.
GRANT VIEW SERVER PERFORMANCE STATE TO wave;
GO
USE wave;
GO
CREATE USER wave FOR LOGIN wave WITH DEFAULT_SCHEMA = dbo;
ALTER ROLE db_owner ADD MEMBER wave;
GO
CREATE PROCEDURE dbo.wave_add @a int, @b int, @total int OUTPUT, @label nvarchar(16) OUTPUT
AS
BEGIN
  SET @total = @a + @b;
  SET @label = N'sum';
END;
GO
