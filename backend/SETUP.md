# 智程跑步教练后端

后端使用 FastAPI、SQLAlchemy 和 MySQL。API 容器使用本机已有 Python API 基础镜像中的运行库，但作为独立容器运行，不读取旧项目数据库、容器卷或配置。Docker Compose 会启动本项目独立 MySQL 并执行 `database/001_init_mysql.sql`。计划生成和训练反馈调整都由 Dify 工作流生成；后端只负责校验与保存工作流结果。

## 启动

在项目根目录执行：

```powershell
docker compose up --build -d
docker compose ps
```

应用入口：<http://localhost:8000/>
健康检查：<http://localhost:8000/api/health>
接口文档：<http://localhost:8000/docs>

本项目使用独立容器 `zhicheng-runner-v1-mysql`、数据库 `zhicheng_runner_v1` 和命名卷 `zhicheng_runner_v1_mysql_data`，不连接其他项目的 MySQL。MySQL 映射到宿主机 `13307` 端口，Navicat 连接地址为 `127.0.0.1:13307`，应用用户 `zhicheng`。密码在项目根目录 `.env` 的 `MYSQL_PASSWORD` 中。

## 配置

首次启动前复制 `.env.example` 为 `.env`，设置唯一的数据库密码和 JWT 密钥。填写两个 Dify 工作流各自的 API Key：`DIFY_PLAN_API_KEY` 对应“10km计划首次生成”，`DIFY_ADJUST_API_KEY` 对应“10km计划训练反馈调整”。本机 Dify API 地址配置为 `http://172.22.0.1/v1`（当前 Docker 网关）；网络网关变化时更新 `DIFY_API_BASE_URL`。密钥只放服务端 `.env`，不要放入前端。MySQL 数据保存在本项目专用命名卷中。普通停止使用 `docker compose down`；该命令保留本项目数据。不要对旧项目执行删除卷命令。

## 主要 API

- `POST /api/auth/register`、`POST /api/auth/login`
- `GET/PUT /api/profile`
- `POST /api/plans/generate`、`GET /api/plans/active`
- `GET /api/workouts/today`、`POST /api/workouts/{id}/start`
- `POST /api/training-records/{id}/finish`
- `POST /api/training-records/{id}/feedback`
- `POST /api/training-records/{id}/adjust-plan`

反馈页只提交 1–5 分的疼痛评分，不采集“是否不适”或部位列表。后端始终按调整知识库规则从评分推导 `discomfort`（`pain>=3` 为 `true`），`discomfort_parts` 始终为空数组。数据库列与 Dify 的 `training_feedback` 字段作为内部派生数据继续使用，不需要数据库迁移或修改 Dify 工作流。

训练反馈调整时，`training_feedback.completed` 同时包含本次实际训练数据：`distanceKm`、`durationMin` 和格式为 `m:ss min/km` 的 `pace`。这些值从 `training_record` 已保存的实际距离、时长和每公里秒数读取；无值时传 `null`。它们与评分和文字备注一起放入现有 `training_feedback` JSON 输入。

当 Dify 的 `rest` / `medical_review` 结果把取消的课程放在 `planChanges`（而 `workouts` 为空）时，后端会校验这些日期仍在允许调整范围内，并将对应课程标记为 `skipped`、时长记为 0。

首次计划流程的起始变量为 `goal`、`longest_run_km`、`latest_10k_minutes`、`train_days`、`target_minutes`、`health_status`、`retrieval_query`、`body_data`。画布显示输出变量 `text`，已发布 API 可能返回 `training_plan`；后端兼容两者。每条计划课程必须带知识库中的 `courseKey` 和准确 `title`，后端会按本地课程目录校验后保存。

每节课的 `distanceRangeKm` 必须是两个递增的有限数字，`paceRangeMinPerKm` 必须包含具体分钟/公里区间。后端保留范围到 workout，`GET /api/plans/active` 和 `GET /api/workouts/today` 会返回这两个字段；`distanceKm` 仍为兼容用的可选单值。旧 workout 缺少新值时，会从关联课程目录中的首次计划知识库课程块读取通用距离和配速范围。

已有数据库升级时，使用项目 MySQL 数据库执行 `database/003_workout_distance_pace.sql`；该脚本不会清空用户数据，可重复执行。新建数据库则由 `database/001_init_mysql.sql` 建立包含新字段的完整结构。升级后需重启/重建 API 容器以加载后端代码。

反馈调整流程的起始变量为 `current_plan`、`training_feedback`，最终输出变量为 `adjusted_plan`、`warmup_stretch_sources`。`adjusted_plan` 对象包含 `status`、`ruleId`、`adjustmentScope`、`workouts`、`planChanges` 和 `feedback_analysis`；不包含 `reason`。后端从该对象读取说明并返回给前端，不配置独立的顶层 `feedback_analysis` 输出。`current_plan.recentWorkouts`提供截至本次反馈课在内最近最多三节训练作为上下文，包含已完成训练但只读；`current_plan.adjustmentTargets`按 `next_1`、`next_2`、`next_3` 和 `current_week`给出可以修改的未来课程。后端校验 Dify 返回的课程身份和调整日期，越界结果不会入库。

若 API Key 未配置，计划/调整接口会返回 503，不会生成本地替代计划。结果页展示 Dify 的反馈分析以及课程 ID、课程名称和训练负荷变化。
