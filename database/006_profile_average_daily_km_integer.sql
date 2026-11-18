-- Store average run-day distance as an integer from 2 to 10 km.
-- Existing profiles were checked before conversion; NULL values are preserved.
SET @schema_name = DATABASE();

SET @ddl = IF(
  EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema=@schema_name AND table_name='runner_profile'
      AND column_name='average_daily_km' AND column_type='tinyint unsigned'
  ),
  'SELECT 1',
  'ALTER TABLE runner_profile MODIFY COLUMN average_daily_km TINYINT UNSIGNED NULL'
);
PREPARE migration_stmt FROM @ddl; EXECUTE migration_stmt; DEALLOCATE PREPARE migration_stmt;

SET @ddl = IF(
  EXISTS(SELECT 1 FROM information_schema.table_constraints WHERE table_schema=@schema_name AND table_name='runner_profile' AND constraint_name='ck_profile_average_daily_km'),
  'SELECT 1',
  'ALTER TABLE runner_profile ADD CONSTRAINT ck_profile_average_daily_km CHECK (average_daily_km IS NULL OR average_daily_km BETWEEN 2 AND 10)'
);
PREPARE migration_stmt FROM @ddl; EXECUTE migration_stmt; DEALLOCATE PREPARE migration_stmt;
