# 前端原型与 API

当前应用使用原生 HTML、CSS 和 JavaScript。页面源码位于 `pages/`，共享样式和流程脚本位于 `assets/`。

现在的流程会调用同源 `/api` 接口；请从项目根目录通过 Docker Compose 启动完整应用，不要用 Python 静态服务器代替 API 服务：

```powershell
docker compose up --build -d
```

然后访问 `http://localhost:8000/`。后端接口文档在 `http://localhost:8000/docs`。有关数据库隔离、Navicat 连接及停止方式，见项目根目录 `README.md`。

`redesign/` 仅为旧页面地址的兼容跳转目录，不放页面实现。
