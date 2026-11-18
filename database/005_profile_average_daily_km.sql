-- Add the runner's average run-day distance without altering existing profiles.
-- Existing rows remain NULL until the runner provides this value.
SET @schema_name = DATABASE();

SET @ddl = IF(
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=@schema_name AND table_name='runner_profile' AND column_name='average_daily_km'),
  'SELECT 1',
  'ALTER TABLE runner_profile ADD COLUMN average_daily_km TINYINT UNSIGNED NULL AFTER longest_run_km'
);
PREPARE migration_stmt FROM @ddl; EXECUTE migration_stmt; DEALLOCATE PREPARE migration_stmt;

SET @ddl = IF(
  EXISTS(SELECT 1 FROM information_schema.table_constraints WHERE table_schema=@schema_name AND table_name='runner_profile' AND constraint_name='ck_profile_average_daily_km'),
  'SELECT 1',
  'ALTER TABLE runner_profile ADD CONSTRAINT ck_profile_average_daily_km CHECK (average_daily_km IS NULL OR average_daily_km BETWEEN 2 AND 10)'
);
PREPARE migration_stmt FROM @ddl; EXECUTE migration_stmt; DEALLOCATE PREPARE migration_stmt;
