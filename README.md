# 智程 AI 跑步教练

智程 10km 跑步训练应用。前端为原生 HTML/CSS/JavaScript，后端为 FastAPI，数据存储于独立 MySQL 容器。

## 项目结构

```text
001.产品相关文件/知识库/     训练课程与计划调整规则
002.产品UI原型/prototype/    UI 参考稿
003.前端代码/frontend/       当前页面与静态资源
004.数据库脚本/              MySQL 初始化 SQL
backend/                     FastAPI 服务
docker-compose.yml           项目独立 MySQL 与 API 容器
```

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
