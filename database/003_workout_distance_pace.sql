-- Apply once to an existing zhicheng_runner_v1 database. Safe to rerun.
SET @schema_name = DATABASE();

SET @ddl = IF(
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=@schema_name AND table_name='workout' AND column_name='distance_min_km'),
  'SELECT 1',
  'ALTER TABLE workout ADD COLUMN distance_min_km DECIMAL(6,2) NULL AFTER distance_km'
);
PREPARE migration_stmt FROM @ddl; EXECUTE migration_stmt; DEALLOCATE PREPARE migration_stmt;

SET @ddl = IF(
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=@schema_name AND table_name='workout' AND column_name='distance_max_km'),
  'SELECT 1',
  'ALTER TABLE workout ADD COLUMN distance_max_km DECIMAL(6,2) NULL AFTER distance_min_km'
);
PREPARE migration_stmt FROM @ddl; EXECUTE migration_stmt; DEALLOCATE PREPARE migration_stmt;

SET @ddl = IF(
  EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=@schema_name AND table_name='workout' AND column_name='pace_range_min_per_km'),
  'SELECT 1',
  'ALTER TABLE workout ADD COLUMN pace_range_min_per_km VARCHAR(1000) NULL AFTER distance_max_km'
);
PREPARE migration_stmt FROM @ddl; EXECUTE migration_stmt; DEALLOCATE PREPARE migration_stmt;

SET @ddl = IF(
  EXISTS(SELECT 1 FROM information_schema.table_constraints WHERE table_schema=@schema_name AND table_name='workout' AND constraint_name='ck_workout_distance_range'),
  'SELECT 1',
  'ALTER TABLE workout ADD CONSTRAINT ck_workout_distance_range CHECK ((distance_min_km IS NULL AND distance_max_km IS NULL) OR (distance_min_km IS NOT NULL AND distance_max_km IS NOT NULL AND distance_min_km > 0 AND distance_max_km >= distance_min_km))'
);
PREPARE migration_stmt FROM @ddl; EXECUTE migration_stmt; DEALLOCATE PREPARE migration_stmt;

ALTER TABLE workout COMMENT = '训练计划中的课程安排、训练目标及距离配速范围';
