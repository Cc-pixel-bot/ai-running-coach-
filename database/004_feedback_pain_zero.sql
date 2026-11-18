-- Expand the feedback pain score to allow 0 = unselected / no pain.
-- Safe to rerun; existing feedback values are preserved.
SET @schema_name = DATABASE();

SET @ddl = IF(
  EXISTS(
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_schema=@schema_name AND constraint_name='ck_feedback_pain'
      AND check_clause NOT LIKE '%between 0 and 5%'
  ),
  'ALTER TABLE training_feedback DROP CHECK ck_feedback_pain',
  'SELECT 1'
);
PREPARE migration_stmt FROM @ddl; EXECUTE migration_stmt; DEALLOCATE PREPARE migration_stmt;

SET @ddl = IF(
  EXISTS(
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_schema=@schema_name AND constraint_name='ck_feedback_pain'
      AND check_clause LIKE '%between 0 and 5%'
  ),
  'SELECT 1',
  'ALTER TABLE training_feedback ADD CONSTRAINT ck_feedback_pain CHECK (pain BETWEEN 0 AND 5)'
);
PREPARE migration_stmt FROM @ddl; EXECUTE migration_stmt; DEALLOCATE PREPARE migration_stmt;
