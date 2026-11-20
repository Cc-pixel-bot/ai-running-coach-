# 云服务器部署清单

本包面向全新云端实例：会创建空白数据库，不导入本机账号、训练计划或训练记录。运行服务为前端/API、MySQL 和 Caddy；MySQL 与 API 不映射公网端口，公网只开放 Caddy 的入口端口。

## 云服务器上需要先完成的事项

1. 准备 Linux 云服务器、固定公网 IP，并使用 SSH 密钥登录。临时 HTTP 测试不需要域名；以后启用 HTTPS 时再准备域名。
2. 在云防火墙/安全组只放行 SSH（建议限制来源 IP）和网站端口。HTTPS 模式放行 TCP 80/443，可选 UDP 443（HTTP/3）；临时 IP/HTTP 测试模式只需放行 TCP 80。不要放行 3306 或 8000。
3. 安装 Docker Engine 和 Docker Compose 插件。
4. 确认 Dify 服务可从云服务器访问，准备“10km计划首次生成”和“10km计划训练反馈调整”两个工作流的服务端 API Key。
5. 若服务器位于中国大陆，先向云服务商确认临时测试和正式网站访问所需的备案/许可要求；依法需要办理的，应按要求完成。
6. 以后切换到 HTTPS 时，将域名 A 记录指向服务器公网 IP。若配置 AAAA 记录，也要确保服务器 IPv6 可用。

## 上传后执行

将 ZIP 解压到服务器，例如 `/opt/zhicheng`，然后进入项目目录：

```bash
cd /opt/zhicheng
cp deploy/.env.cloud.example .env
```

编辑 `.env`，填写 Dify 地址和两个工作流 API Key。用服务器上的密码工具分别生成数据库密码和 JWT 密钥，不要沿用示例值，也不要把 `.env` 上传到 GitHub。HTTP 测试模式暂时不使用 `DOMAIN`；启用 HTTPS 时再把它改成实际域名。可用下面命令生成随机值：

```bash
openssl rand -hex 32
```

### 临时朋友测试：公网 IP + HTTP

若暂时没有域名，先用服务器公网 IPv4 测试：

```bash
docker compose -f docker-compose.http-test.yml up --build -d
docker compose -f docker-compose.http-test.yml ps
```

手机浏览器访问 `http://服务器公网IP`。HTTP 不加密登录密码、训练档案和训练反馈等数据，适合短期功能演示；请只用测试账号和虚构信息，不要收集真实健康/伤病数据。不要把此模式作为正式服务长期开放。

### 域名 + HTTPS 模式

域名解析到服务器并准备就绪后，使用域名配置启动：

```bash
docker compose -f docker-compose.cloud.yml up --build -d
docker compose -f docker-compose.cloud.yml ps
docker compose -f docker-compose.cloud.yml logs --tail 100 caddy api mysql
```

域名解析生效且 80/443 可从公网访问时，Caddy 会自动签发并续期 HTTPS 证书；Caddy 的 `/data` 卷必须长期保留。详见 [Caddy 自动 HTTPS 文档](https://caddyserver.com/docs/automatic-https)。

## 上线后检查

1. 打开 `https://你的域名/api/health`，确认返回 `status: ok` 和 `database: connected`。
2. 用手机浏览器打开 `https://你的域名`，注册新账号并登录。
3. 检查档案保存、计划生成、计划查看和反馈调整；确认 Dify 两个工作流正常。
4. 设置并实际演练数据库备份与恢复。MySQL 数据保存在 Docker 命名卷 `zhicheng_cloud_mysql_data` 中；重建/升级时不要删除该卷。
5. 记录服务器系统更新、密钥轮换、域名和备份恢复负责人。

## 更新与日常运维

上传新版本后，在项目目录执行：

```bash
docker compose -f docker-compose.cloud.yml up --build -d
docker compose -f docker-compose.cloud.yml ps
```

查看日志：

```bash
docker compose -f docker-compose.cloud.yml logs -f api
```

`.env` 和数据库卷都应留在服务器并限制管理员访问。此部署包不含本机 `.env`、账号或数据库数据，也不会将本机数据迁移到云端。
