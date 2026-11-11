# 智程跑步教练后端

后端使用 FastAPI、SQLAlchemy 和 MySQL。API 容器使用本机已有 Python API 基础镜像中的运行库，但作为独立容器运行，不读取旧项目数据库、容器卷或配置。Docker Compose 会启动本项目独立 MySQL 并执行 `004.数据库脚本/001_init_mysql.sql`。计划生成和训练反馈调整都由 Dify 工作流生成；后端只负责校验与保存工作流结果。

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

首次计划流程的起始变量为 `goal`、`longest_run_km`、`latest_10k_minutes`、`train_days`、`target_minutes`、`health_status`、`retrieval_query`、`body_data`。画布显示输出变量 `text`，已发布 API 可能返回 `training_plan`；后端兼容两者。每条计划课程必须带知识库中的 `courseKey` 和准确 `title`，后端会按本地课程目录校验后保存。

反馈调整流程的起始变量为 `current_plan`、`training_feedback`，最终输出变量为 `adjusted_plan`、`warmup_stretch_sources`、`feedback_analysis`。`current_plan.recentWorkouts`提供截至本次反馈课在内最近最多三节训练作为上下文，包含已完成训练但只读；`current_plan.adjustmentTargets`按 `next_1`、`next_2`、`next_3` 和 `current_week`给出可以修改的未来课程。后端校验 Dify 返回的课程身份和调整日期，越界结果不会入库。

若 API Key 未配置，计划/调整接口会返回 503，不会生成本地替代计划。结果页展示 Dify 的反馈分析以及课程 ID、课程名称和训练负荷变化。
