# 前端原型

当前应用使用原生 HTML、CSS 和 JavaScript，无需安装依赖或构建。

## 目录

```text
frontend/
├─ index.html       应用入口
├─ pages/           唯一页面源码（01–19）
├─ assets/          页面共享样式、脚本和图片
└─ redesign/        旧页面地址的兼容跳转，不放页面实现
```

页面公共行为由 `assets/redesign-app.js` 管理；共享样式由 `assets/redesign.css` 管理。部分页面还使用 `assets/mobile.css`。

## 本地运行

```powershell
cd .\003.前端代码\frontend
python -m http.server 8080
```

访问 `http://localhost:8080/`。也可直接访问 `pages/` 下对应页面。`redesign/` 中的旧地址会自动转到相同的 `pages/` 文件。

## 说明

- `pages/` 是唯一维护入口。新增或修改页面时，不要复制一份到 `redesign/`。
- `assets/navigation.js` 是旧版原型脚本；当前页面流程使用 `assets/redesign-app.js`。
- 当前没有后端服务、数据库脚本、包管理器配置或构建步骤；页面仍是原型。
