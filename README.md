# 智程 AI 跑步教练

智程 10km 跑步训练应用。前端为原生 HTML/CSS/JavaScript，后端为 FastAPI，数据存储于独立 MySQL 容器。

## 项目结构

```text
001.产品相关文件/
  产品prd/                   产品需求与范围说明
  知识库/                    首次计划课程库、反馈调整规则、动作参考
002.产品UI原型/prototype/    UI 设计参考，不是线上运行页面
003.前端代码/frontend/
  pages/                     当前正式页面（01–19）
  assets/                    共享脚本、样式和图片资源
  redesign/                  旧页面地址的兼容跳转，不放页面实现
004.数据库脚本/
  001_init_mysql.sql         新库完整初始化结构
  002_表中文注释.sql         数据表字段注释
  003_workout_distance_pace.sql  已有数据库的距离/配速字段升级
backend/                     FastAPI API 与 Dify 调用、校验和持久化
docker-compose.yml           本项目独立 API 与 MySQL 服务
.env.example                 本地配置模板；实际密钥仅保存在未跟踪的 .env
```

正式运行入口以 `003.前端代码/frontend/`、`backend/` 和 `004.数据库脚本/` 为准。UI 原型、兼容跳转页不作为正式页面源文件。首次计划和训练反馈调整均由 Dify 工作流生成；后端负责身份、参数、课程与计划约束校验，以及保存和返回结果。

## 启动应用

在项目根目录执行：

```powershell
Copy-Item .env.example .env  # 首次启动时；本工作区已有本地 .env 时无需覆盖
# 编辑 .env，设置数据库密码和 JWT_SECRET
docker compose up --build -d
```

访问 <http://localhost:8000/>，接口说明见 <http://localhost:8000/docs>，服务状态见 <http://localhost:8000/api/health>。

本项目数据库独立运行：容器名为 `zhicheng-runner-v1-mysql`，数据库名 `zhicheng_runner_v1`，Docker 数据卷 `codex-ai_zhicheng_runner_v1_mysql_data`，宿主机端口 `13307`。现有 MySQL `3306` 不会被本项目修改。Navicat 连接使用 `127.0.0.1:13307`、用户 `zhicheng`；密码在本机 `.env` 的 `MYSQL_PASSWORD`。

停止服务但保留新项目数据：

```powershell
docker compose down
```

不要删除或复用其他项目的数据库卷。

## 当前功能边界

- 注册登录、跑者档案、训练计划、训练开始与完成记录、反馈、下一次训练调整均由后端 API 持久化。
- 计划生成和训练反馈调整均调用 Dify 工作流；后端只负责传参、校验输出并保存结果。将两个工作流 API Key 写入 `.env` 后即可启用 Dify 调用。流程变量映射和当前 Dify 输出契约见 [backend/SETUP.md](backend/SETUP.md)。
- 训练页面的计时和距离仍为原型模拟值；连接手机 GPS 和健康设备需要后续开发。
- 前端源码以 `003.前端代码/frontend/pages/` 为准。
- 新建数据库使用 `001_init_mysql.sql`；已有数据库升级使用对应的编号升级脚本，不要删除数据卷来应用结构变更。
