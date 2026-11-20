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

反馈页疼痛评分可留空；未选择时提交 `pain=0` 并按无痛处理，1–2 分为轻微、3 分为中度、4–5 分为严重。前端不采集独立的“是否不适”或部位列表。后端按评分推导 `discomfort`（`pain>=3` 为 `true`），`discomfort_parts` 始终为空数组。现有数据库需执行 `database/004_feedback_pain_zero.sql` 将疼痛评分约束从 1–5 调整为 0–5；无需修改列类型或清理既有记录。Dify 调整知识库及“分析训练反馈”节点的映射规则同步修改。

训练反馈调整时，`training_feedback.completed` 同时包含本次实际训练数据：`distanceKm`、`durationMin` 和格式为 `m:ss min/km` 的 `pace`。这些值从 `training_record` 已保存的实际距离、时长和每公里秒数读取；无值时传 `null`。它们与评分和文字备注一起放入现有 `training_feedback` JSON 输入。

调整工作流契约：Dify 只输出 `planChanges` 一份变更清单，后端按该清单校验目标范围、课程身份和目标距离并保存；不再要求模型重复生成 `workouts`。每条普通调整必须至少改变距离、时长、课程类型/身份、强度或配速之一，避免生成了调整记录但计划实质未变。疼痛评分≥4时，后端强制要求 `medical_review`，并取消所选调整范围内全部未来课程。休息/取消按每条课程的 `type=rest`、`durationMin=0` 和 `distanceKm=0` 识别，不依赖全局 `status`，因此 `reduce` 或 `recovery` 结果也能包含单门取消课。取消项保留目标课原有 `week/day/courseKey/title`，后端把这节课标记为 `skipped`；普通恢复课必须提供正时长或距离。

首次计划流程的起始变量为 `goal`、`longest_run_km`、`latest_10k_minutes`、`train_days`、`target_minutes`、`health_status`、`body_data`、`average_daily_km`。后端不再查询课程目录并拼接候选 `courseKey` 到检索查询；Dify 的“生成 retrieval_query”代码节点从档案中的等级、阶段标签生成检索条件，并另行输出估算周跑量（平均日跑量 × 每周训练次数）及每周跑步次数。估算值目前尚未接入模型提示词。检索节点使用代码节点输出的 `retrieval_query`。提示词文本未修改，`retrieval_query` 在提示词中的变量映射改为代码节点输出。画布显示输出变量 `text`，已发布 API 可能返回 `training_plan`；后端兼容两者。每条计划课程必须带知识库中的 `courseKey` 和准确 `title`，后端会按本地课程目录校验后保存。目录基准固定保存在 `backend/app/course_catalog_dify.json`，按 Dify 工作流关联数据集的 UI 对账维护；启动时仅同步该快照，并停用快照之外的旧目录项，不删除旧记录。不要从仓库知识库 Markdown 导入课程目录。`course_catalog.type` 原样保存 Dify 类型，后端在运行时映射为计划课类型；已存在的长距离跑走课编号冲突按课程名对应的编号修正。更新课程分类约束时执行 `database/007_course_catalog_dify_types.sql`。档案缺少平均日跑量时，计划生成接口返回 409，要求先补充 1–10 公里的整数值。

跑者档案新增 `averageDailyKm`（1–10 km 整数），表示平均日跑量。`GET/PUT /api/profile` 会读取和保存此字段；已有档案不会被自动估算或回填。后端将此值作为 `average_daily_km` 传入首次计划 Dify 流程。

每节跑步课的 `distanceRangeKm` 必须是两个递增的有限数字，`paceRangeMinPerKm` 必须包含具体分钟/公里区间；Dify 还必须给出具体目标 `distanceKm`。后端将课程目录范围向外扩展到最近的 0.5 km 步进后校验目标，并将目标归一化到 0.5 km 步进。例如课程范围 `3.7–4.6 km` 接受 `3.5–5.0 km` 范围内的目标；超出扩展范围仍会拒绝。后端把归一化目标写入已有 `workout.distance_km`，`GET /api/plans/active` 和 `GET /api/workouts/today` 返回目标值及向外扩展后的可选范围。此改动复用现有列，不需要新增数据库迁移；旧计划不回填。

已有数据库升级时，依次使用项目 MySQL 数据库执行 `database/003_workout_distance_pace.sql`、`database/004_feedback_pain_zero.sql`、`database/005_profile_average_daily_km.sql`、`database/006_profile_average_daily_km_integer.sql`、`database/007_course_catalog_dify_types.sql` 和 `database/008_profile_average_daily_km_min_1.sql`；这些脚本不会清空用户数据，可重复执行。新建数据库则由 `database/001_init_mysql.sql` 建立完整结构。平均日跑量范围为 1–10 km 整数；旧档案不伪造回填，字段保持空值。升级后需重启/重建 API 容器以加载后端代码。

反馈调整流程的起始变量为 `current_plan`、`training_feedback`，最终输出变量为 `adjusted_plan`、`warmup_stretch_sources`。`adjusted_plan` 对象包含 `status`、`ruleId`、`adjustmentScope`、`planChanges` 和 `feedback_analysis`；不包含 `reason` 或 `workouts`。`feedback_analysis` 必须是三行自然教练口吻：第一行说明本次训练与反馈，第二行概括整体调整方向和主要课程类型变化，不复述卡片上逐门的距离与配速，第三行体贴鼓励或安全提醒。后端按实际课程变更生成该说明并返回给前端，不配置独立的顶层 `feedback_analysis` 输出。`current_plan.runnerProfile`提供跑者档案；`current_plan.recentWorkouts`提供截至本次反馈课在内最近最多三节训练作为上下文，包含已完成训练但只读；`current_plan.adjustmentTargets`按 `next_1`、`next_2`、`next_3` 和 `current_week`给出可以修改的未来课程。对于 `reduce`/`recovery`，后端保留 Dify 返回的课程身份，并以原计划为基准生成个性化负荷范围：距离范围为原距离的 80%–90%，目标距离取原距离的 85%；配速每公里用时的下界增加 5%、上界增加 10%（向上取整到秒），因此配速整体变慢。该个性化区间覆盖课程目录的通用默认范围，但课程 `courseKey`/类型仍须匹配活动目录记录；计算结果及三行教练说明会写入数据库并返回前端。未调整课程沿用原值。如果原课程没有有效距离或配速、无法计算安全的减量处方，则跳过该课程；没有任何可保存变更时保留原计划，不创建重复版本。

若 API Key 未配置，计划/调整接口会返回 503，不会生成本地替代计划。结果页展示 Dify 的反馈分析以及课程 ID、课程名称和训练负荷变化。
