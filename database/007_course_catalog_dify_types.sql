-- Keep course_catalog.type equal to the exact Dify metadata value. The backend
-- maps these values to its smaller operational workout categories at runtime.
ALTER TABLE course_catalog DROP CHECK ck_course_type;
ALTER TABLE course_catalog ADD CONSTRAINT ck_course_type CHECK (
  type IN ('easy','aerobic_base','easy,aerobic_base','run_walk','recovery','long','long_run','quality','strides','tempo','interval','other')
);
