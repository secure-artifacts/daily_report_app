# 代码安全审计记录

审计日期：2026-05-24

## 审计口径

本次按“可部署网页代码”审核，不再按 Windows 桌面软件、安装包或 Electron 发布审核。

当前有效入口：

- 前端：`index.html`、`styles.css`、`app.js`
- 服务端：`server.cjs`
- 启动：`npm start`

已移除旧桌面入口：

- Electron 主进程与 preload
- Electron 构建脚本和依赖
- Python 桌面版入口
- 软件启动脚本

## 主要安全结论

- 浏览器端不再调用 `localStorage`、IndexedDB、文件夹选择器或 Electron bridge。
- 浏览器端不再自动保存本地副本或本地备份；解锁后的数据只保存在内存里，并通过云端 API 写入服务端。
- API 使用密码保护：`POST /api/unlock` 校验密码后才返回数据，`GET /api/data` 和 `PUT /api/data` 需要 `X-App-Password`。
- 服务端静态文件响应和 API 响应均设置 `Cache-Control: no-store`，降低浏览器和中间缓存保存数据的概率。
- 服务端阻止直接读取 `data/` 目录，避免 `report_data.json` 被当作静态文件下载。
- 服务端写入数据使用临时文件加 rename，降低写入中断造成 JSON 损坏的概率。
- `package.json` 已移除 Electron 依赖，`npm audit` 当前为 0 个漏洞。

## 已检查项目

- 依赖审计：`npm install --package-lock-only --ignore-scripts` 完成，审计 1 个 package，0 个漏洞。
- 语法检查：使用 `npm run check` 检查 `app.js` 和 `server.cjs`。
- 敏感存储扫描：运行代码中未发现 `localStorage`、IndexedDB、Electron bridge、文件夹选择器调用。
- 桌面入口清理：旧软件相关入口不再参与构建和启动。
- 接口冒烟测试：`POST /api/unlock` 使用默认密码可读取数据；未带密码访问 `GET /api/data` 返回 401；直接访问 `/data/report_data.json` 返回 403。

## 风险和建议

- 默认密码仍是 `999`，生产部署必须通过管理员页面或 `APP_PASSWORD` 修改。
- 当前密码字段仍保存在云端 JSON 中，适合轻量内网/小团队使用；如果要公开互联网访问，建议升级为服务端哈希密码、登录会话、限速和审计日志。
- 内置服务端没有多用户权限分级，拿到密码的人即可查看和修改全部数据。
- 多人同时修改同一条记录时仍以最后写入为准；如果并发很高，建议迁移到数据库并增加记录级版本号。
- 生产环境必须使用 HTTPS，否则密码和数据可能在传输链路上被截获。
- `data/report_data.json` 已加入 `.gitignore`，部署和备份时不要把真实数据提交到代码仓库。

## 部署前检查清单

1. 修改默认密码。
2. 使用 HTTPS 反向代理或受信任内网。
3. 确认 `data/report_data.json` 不在静态目录中公开访问。
4. 确认服务器用户只拥有必要的数据目录读写权限。
5. 定期备份服务端 `data/report_data.json`。
