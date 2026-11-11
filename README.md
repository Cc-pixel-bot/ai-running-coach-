# 智程 AI 跑步教练

移动端 AI 跑步教练原型。当前前端为原生 HTML、CSS 和 JavaScript，多页面静态运行。

## 项目结构

```text
001.产品相关文件/
├─ 产品prd/       产品需求文档
└─ 知识库/        训练计划生成、调整与动作知识库
002.产品UI原型/
└─ prototype/     UI 原型参考稿及其独立资源
003.前端代码/
└─ frontend/      当前前端项目（保留既有工作路径）
   ├─ index.html   登录入口
   ├─ pages/       唯一的页面源码
   ├─ assets/      共享样式、脚本和图片
   └─ redesign/    旧访问地址的兼容跳转页
backend/           后端目录；当前尚无服务实现
004.数据库/        数据库目录；当前尚无迁移或建表脚本
```

## 启动前端

```powershell
cd .\003.前端代码\frontend
python -m http.server 8080
```

浏览器打开 `http://localhost:8080/`。应用入口会跳转至 `pages/01 登录与注册.html`。

## 当前边界

- 前端源码以 `003.前端代码/frontend/pages/` 为准；不要在 `redesign/` 中维护页面副本。
- `redesign/` 保留旧链接并转到 `pages/`，方便已有书签继续使用。
- `002.产品UI原型/prototype/` 是独立的参考原型，不参与当前应用运行。
- 后端和数据库目录目前只是预留位置；尚未接入持久化服务、构建流程或自动化测试。
