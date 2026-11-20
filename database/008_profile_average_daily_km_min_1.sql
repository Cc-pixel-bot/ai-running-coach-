-- Allow an average run-day distance of 1 km while retaining the 10 km maximum.
SET @schema_name = DATABASE();

SET @ddl = IF(
  EXISTS(SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema=@schema_name AND table_name='runner_profile'
      AND constraint_name='ck_profile_average_daily_km'),
  'ALTER TABLE runner_profile DROP CHECK ck_profile_average_daily_km',
  'SELECT 1'
);
PREPARE migration_stmt FROM @ddl; EXECUTE migration_stmt; DEALLOCATE PREPARE migration_stmt;

ALTER TABLE runner_profile
  ADD CONSTRAINT ck_profile_average_daily_km
  CHECK (average_daily_km IS NULL OR average_daily_km BETWEEN 1 AND 10);
