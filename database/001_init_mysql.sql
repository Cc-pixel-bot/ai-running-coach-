-- 智程 AI 跑步教练（V1）MySQL 核心数据库结构
-- 适用 MySQL 8.0.16+（CHECK 约束从 8.0.16 起生效），使用 InnoDB / utf8mb4。
-- Navicat 可直接执行本文件。UUID 由后端生成并以 CHAR(36) 传入。
-- 密码仅保存后端生成的 Argon2id/bcrypt 哈希，禁止保存明文密码。

CREATE DATABASE IF NOT EXISTS zhicheng_runner_v1
  CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE zhicheng_runner_v1;

CREATE TABLE IF NOT EXISTS app_user (
    id              CHAR(36) NOT NULL PRIMARY KEY,
    account         VARCHAR(64) NOT NULL,
    password_hash   VARCHAR(255) NOT NULL,
    status          VARCHAR(16) NOT NULL DEFAULT 'active',
    created_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    last_login_at   DATETIME(3) NULL,
    UNIQUE KEY uq_app_user_account (account),
    CONSTRAINT ck_app_user_status CHECK (status IN ('active', 'disabled', 'deleted')),
    CONSTRAINT ck_app_user_account CHECK (account REGEXP '^[A-Za-z0-9]+$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='用户账号、密码哈希与账号状态';

-- 一位跑者一份当前档案；计划保存档案快照，以保留生成当时的依据。
CREATE TABLE IF NOT EXISTS runner_profile (
    user_id             CHAR(36) NOT NULL PRIMARY KEY,
    height_cm           DECIMAL(5,2) NOT NULL,
    weight_kg           DECIMAL(5,2) NOT NULL,
    goal                VARCHAR(32) NOT NULL DEFAULT 'complete_10k',
    longest_run_km      DECIMAL(6,2) NOT NULL,
    latest_10k_minutes  DECIMAL(6,2) NULL,
    train_days          TINYINT UNSIGNED NOT NULL,
    target_minutes      DECIMAL(6,2) NULL,
    health_status       VARCHAR(2000) NOT NULL DEFAULT '',
    body_data           JSON NOT NULL,
    updated_at          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    CONSTRAINT fk_runner_profile_user FOREIGN KEY (user_id) REFERENCES app_user(id) ON DELETE CASCADE,
    CONSTRAINT ck_profile_height CHECK (height_cm BETWEEN 100 AND 250),
    CONSTRAINT ck_profile_weight CHECK (weight_kg BETWEEN 25 AND 300),
    CONSTRAINT ck_profile_goal CHECK (goal = 'complete_10k'),
    CONSTRAINT ck_profile_longest_run CHECK (longest_run_km >= 0),
    CONSTRAINT ck_profile_latest_10k CHECK (latest_10k_minutes IS NULL OR latest_10k_minutes > 0),
    CONSTRAINT ck_profile_train_days CHECK (train_days BETWEEN 1 AND 7),
    CONSTRAINT ck_profile_target CHECK (target_minutes IS NULL OR target_minutes > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='跑者身体数据、训练目标与基础档案';

CREATE TABLE IF NOT EXISTS training_plan (
    id                  CHAR(36) NOT NULL PRIMARY KEY,
    user_id             CHAR(36) NOT NULL,
    version             INT UNSIGNED NOT NULL,
    status              VARCHAR(16) NOT NULL,
    title               VARCHAR(160) NOT NULL,
    goal                VARCHAR(32) NOT NULL DEFAULT 'complete_10k',
    target_minutes      DECIMAL(6,2) NULL,
    weeks               TINYINT UNSIGNED NOT NULL,
    train_days          TINYINT UNSIGNED NOT NULL,
    source              VARCHAR(24) NOT NULL DEFAULT 'dify',
    summary             TEXT NOT NULL,
    profile_snapshot    JSON NOT NULL,
    generation_request_id CHAR(36) NULL,
    created_at          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    superseded_at       DATETIME(3) NULL,
    active_slot         TINYINT GENERATED ALWAYS AS (CASE WHEN status = 'active' THEN 1 ELSE NULL END) STORED,
    UNIQUE KEY uq_plan_user_version (user_id, version),
    UNIQUE KEY uq_plan_one_active (user_id, active_slot),
    KEY ix_plan_user_created (user_id, created_at),
    CONSTRAINT fk_plan_user FOREIGN KEY (user_id) REFERENCES app_user(id) ON DELETE CASCADE,
    CONSTRAINT ck_plan_status CHECK (status IN ('active', 'superseded', 'failed')),
    CONSTRAINT ck_plan_goal CHECK (goal = 'complete_10k'),
    CONSTRAINT ck_plan_target CHECK (target_minutes IS NULL OR target_minutes > 0),
    CONSTRAINT ck_plan_weeks CHECK (weeks BETWEEN 8 AND 12),
    CONSTRAINT ck_plan_train_days CHECK (train_days BETWEEN 1 AND 7),
    CONSTRAINT ck_plan_source CHECK (source IN ('dify', 'manual', 'import'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='训练计划版本、目标、周期与生成状态';

-- 知识库课程目录和来源引用。正式生成计划时，后端应确保每个 workout 关联有效课程。
CREATE TABLE IF NOT EXISTS course_catalog (
    id              CHAR(36) NOT NULL PRIMARY KEY,
    source_key      VARCHAR(160) NOT NULL,
    name            VARCHAR(160) NOT NULL,
    type            VARCHAR(24) NOT NULL,
    level           VARCHAR(24) NULL,
    content         JSON NOT NULL,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    synced_at       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE KEY uq_course_source_key (source_key),
    CONSTRAINT ck_course_type CHECK (type IN ('easy','recovery','long','quality','tempo','interval','other'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='训练课程目录，包含课程编号、名称和知识库内容';

CREATE TABLE IF NOT EXISTS workout (
    id                  CHAR(36) NOT NULL PRIMARY KEY,
    plan_id             CHAR(36) NOT NULL,
    course_id           CHAR(36) NULL,
    week_no             TINYINT UNSIGNED NOT NULL,
    day_no              TINYINT UNSIGNED NOT NULL,
    type                VARCHAR(24) NOT NULL,
    title               VARCHAR(160) NOT NULL,
    duration_min        SMALLINT UNSIGNED NULL,
    distance_km         DECIMAL(6,2) NULL,
    distance_min_km     DECIMAL(6,2) NULL,
    distance_max_km     DECIMAL(6,2) NULL,
    pace_range_min_per_km VARCHAR(1000) NULL,
    intensity           VARCHAR(120) NOT NULL,
    talk_test           VARCHAR(1000) NOT NULL DEFAULT '',
    purpose             VARCHAR(1000) NOT NULL DEFAULT '',
    prerequisite        VARCHAR(1000) NOT NULL DEFAULT '',
    downgrade_rule      VARCHAR(1000) NOT NULL DEFAULT '',
    status              VARCHAR(16) NOT NULL DEFAULT 'scheduled',
    started_at          DATETIME(3) NULL,
    UNIQUE KEY uq_workout_plan_week_day (plan_id, week_no, day_no),
    KEY ix_workout_plan_status (plan_id, status, week_no, day_no),
    CONSTRAINT fk_workout_plan FOREIGN KEY (plan_id) REFERENCES training_plan(id) ON DELETE CASCADE,
    CONSTRAINT fk_workout_course FOREIGN KEY (course_id) REFERENCES course_catalog(id) ON DELETE RESTRICT,
    CONSTRAINT ck_workout_week CHECK (week_no BETWEEN 1 AND 12),
    CONSTRAINT ck_workout_day CHECK (day_no BETWEEN 1 AND 7),
    CONSTRAINT ck_workout_type CHECK (type IN ('easy','recovery','long','quality','tempo','interval','rest','other')),
    CONSTRAINT ck_workout_status CHECK (status IN ('scheduled','in_progress','completed','partial','missed','skipped')),
    CONSTRAINT ck_workout_has_target CHECK (duration_min IS NOT NULL OR distance_km IS NOT NULL),
    CONSTRAINT ck_workout_positive_distance CHECK (distance_km IS NULL OR distance_km > 0),
    CONSTRAINT ck_workout_distance_range CHECK (
        (distance_min_km IS NULL AND distance_max_km IS NULL)
        OR (distance_min_km IS NOT NULL AND distance_max_km IS NOT NULL
            AND distance_min_km > 0 AND distance_max_km >= distance_min_km)
    )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='训练计划中的课程安排与训练目标';

CREATE TABLE IF NOT EXISTS training_record (
    id                  CHAR(36) NOT NULL PRIMARY KEY,
    workout_id          CHAR(36) NOT NULL,
    user_id             CHAR(36) NOT NULL,
    status              VARCHAR(16) NOT NULL,
    actual_distance_km  DECIMAL(7,2) NULL,
    actual_duration_min DECIMAL(7,2) NULL,
    pace_seconds_per_km INT UNSIGNED NULL,
    started_at          DATETIME(3) NULL,
    completed_at        DATETIME(3) NULL,
    created_at          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE KEY uq_training_record_workout (workout_id),
    KEY ix_training_record_user_date (user_id, created_at),
    CONSTRAINT fk_record_workout FOREIGN KEY (workout_id) REFERENCES workout(id) ON DELETE RESTRICT,
    CONSTRAINT fk_record_user FOREIGN KEY (user_id) REFERENCES app_user(id) ON DELETE CASCADE,
    CONSTRAINT ck_record_status CHECK (status IN ('completed','partial','missed')),
    CONSTRAINT ck_record_distance CHECK (actual_distance_km IS NULL OR actual_distance_km >= 0),
    CONSTRAINT ck_record_duration CHECK (actual_duration_min IS NULL OR actual_duration_min >= 0),
    CONSTRAINT ck_record_pace CHECK (pace_seconds_per_km IS NULL OR pace_seconds_per_km > 0),
    CONSTRAINT ck_record_time CHECK (completed_at IS NULL OR started_at IS NULL OR completed_at >= started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='单次训练执行记录及实际距离、时长和配速';

CREATE TABLE IF NOT EXISTS training_feedback (
    id                  CHAR(36) NOT NULL PRIMARY KEY,
    training_record_id  CHAR(36) NOT NULL,
    user_id             CHAR(36) NOT NULL,
    completion          VARCHAR(16) NOT NULL,
    subjective          TINYINT UNSIGNED NOT NULL,
    physical            TINYINT UNSIGNED NOT NULL,
    pain                TINYINT UNSIGNED NOT NULL,
    discomfort          BOOLEAN NOT NULL DEFAULT FALSE,
    discomfort_parts    JSON NOT NULL,
    note                VARCHAR(200) NOT NULL DEFAULT '',
    analysis_result     JSON NULL,
    created_at          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE KEY uq_feedback_record (training_record_id),
    KEY ix_feedback_user_date (user_id, created_at),
    CONSTRAINT fk_feedback_record FOREIGN KEY (training_record_id) REFERENCES training_record(id) ON DELETE CASCADE,
    CONSTRAINT fk_feedback_user FOREIGN KEY (user_id) REFERENCES app_user(id) ON DELETE CASCADE,
    CONSTRAINT ck_feedback_completion CHECK (completion IN ('completed','partial','missed','unknown')),
    CONSTRAINT ck_feedback_subjective CHECK (subjective BETWEEN 1 AND 5),
    CONSTRAINT ck_feedback_physical CHECK (physical BETWEEN 1 AND 5),
    CONSTRAINT ck_feedback_pain CHECK (pain BETWEEN 1 AND 5)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='训练反馈、身体状态、疼痛信息与分析结果';

-- AI 调用审计摘要与幂等键；不要在摘要中存储密码或密钥。
CREATE TABLE IF NOT EXISTS ai_workflow_run (
    id                  CHAR(36) NOT NULL PRIMARY KEY,
    user_id             CHAR(36) NOT NULL,
    workflow_type       VARCHAR(24) NOT NULL,
    idempotency_key     VARCHAR(160) NOT NULL,
    status              VARCHAR(16) NOT NULL,
    request_summary     JSON NOT NULL,
    response_summary    JSON NULL,
    validation_result   JSON NULL,
    error_code          VARCHAR(80) NULL,
    related_plan_id     CHAR(36) NULL,
    related_feedback_id CHAR(36) NULL,
    created_at          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    finished_at         DATETIME(3) NULL,
    UNIQUE KEY uq_ai_workflow_idempotency (user_id, workflow_type, idempotency_key),
    KEY ix_ai_workflow_user_created (user_id, created_at),
    CONSTRAINT fk_ai_run_user FOREIGN KEY (user_id) REFERENCES app_user(id) ON DELETE CASCADE,
    CONSTRAINT fk_ai_run_plan FOREIGN KEY (related_plan_id) REFERENCES training_plan(id) ON DELETE SET NULL,
    CONSTRAINT fk_ai_run_feedback FOREIGN KEY (related_feedback_id) REFERENCES training_feedback(id) ON DELETE SET NULL,
    CONSTRAINT ck_ai_run_type CHECK (workflow_type IN ('plan_generate','feedback_analyze','plan_adjust')),
    CONSTRAINT ck_ai_run_status CHECK (status IN ('pending','succeeded','failed'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='Dify 工作流调用记录、请求响应摘要与校验结果';
