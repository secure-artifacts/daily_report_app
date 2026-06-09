# 小组报数日记

这是一个可以部署到 Vercel 的网页版本。推荐模式是本地优先保存 + Vercel 云数据库实时分发；管理员本地中心和 Google Drive 共享文件夹用于备用、导出、额度满时保底和二次汇总。

## 数据同步方式

### 推荐：Vercel 云数据库实时同步

1. 在 Vercel Marketplace 里给项目添加 Postgres 数据库，推荐 Neon 或 Supabase Postgres。
2. 确认 Vercel 项目环境变量里有 `POSTGRES_URL` 或 `DATABASE_URL`。Neon 集成通常会自动创建 `POSTGRES_URL`。
3. 添加环境变量 `TEAM_SYNC_TOKEN`，请使用至少 16 位的强随机口令，不要使用默认、短口令或与其他系统共用的密码。
4. 重新部署 Vercel。
5. 成员打开网页输入应用密码后，会自动读取 Vercel 云数据库。
6. 成员编辑记录时会延迟自动写入 Vercel 云数据库；点击“提交”会立即强制同步当前记录。
7. 成员无需选择文件夹，也不需要导入导出；这些云端和备份操作只放在管理员后台。

Vercel 云同步会使用同一张最新状态表：

- `daily_report_cloud_state`：团队当前最新数据，用于成员提交、管理员统计和恢复。
- `daily_report_cloud_events`：每次自动同步或提交的历史快照，用于误覆盖后的追溯恢复。

### 备用：Google Drive 共享文件夹

1. 团队负责人在 Google Drive 里创建一个共享文件夹。
2. 每个成员电脑安装 Google Drive 桌面版，并同步这个共享文件夹。
3. 管理员打开“管理员 / 同步与备份”，点击“选择备用文件夹”。
4. 选择本机 Google Drive 里的同一个共享文件夹。
5. 应用会在该文件夹里创建或读取 `report_data.json`。

未配置云数据库时，Vercel 不保存报数记录，不上传内部数据文件；这时数据仍依赖 Google Drive 共享文件夹。如果成员没有选择共享文件夹，提交只会留在自己的浏览器草稿里。

### 保底：管理员本地中心

管理员打开“管理员 / 同步与备份”并输入管理员密码后，可以使用“管理员本地中心”：

1. “合并到管理员中心”会把当前本机草稿、已添加来源文件夹和可读取的汇总文件夹合并到管理员浏览器本地副本。
2. “中心写入共享”会把管理员中心写入已选择的备用文件夹或汇总文件夹，适合 Vercel/Neon 额度满时先保底。
3. “中心回灌云同步”会在云数据库恢复后，把管理员本地中心重新写回当前选中的云同步通道。

成员网页不能直接写入管理员电脑硬盘；如果 Vercel 不可用，成员数据会先留在成员自己的浏览器草稿，或写入成员已经选择的同一个共享文件夹。管理员再通过来源文件夹合并到中心。

选择同一个共享文件夹后，应用会额外维护 `daily_report_clients/*.json` 成员副本。每台电脑写自己的副本文件，管理员本地中心会扫描这些副本合并，避免多台电脑同时抢写同一个总文件。

### 备用云：Cloudflare Worker + D1

如果 Neon/Vercel 免费额度满了，可以部署 `cloudflare-worker.mjs` 作为第二云同步通道。前端登录页和管理员“同步与备份”里都可以填写 Worker 地址；留空则继续使用 Vercel 默认接口。

1. 在 Cloudflare 创建一个 D1 数据库。
2. 创建 Worker，把 `cloudflare-worker.mjs` 作为 Worker 代码；如果用 Wrangler，可以复制 `wrangler.toml.example` 为 `wrangler.toml` 后填写 D1 的 `database_id`。
3. 给 Worker 绑定 D1，绑定名必须是 `DB`。
4. 给 Worker 设置 Secret：`TEAM_SYNC_TOKEN`，也可以设置 `APP_PASSWORD`；值要和成员登录用的应用密码一致。
5. 给 Worker 设置 Secret：`CLOUD_SYNC_ENCRYPTION_KEY`，请使用 32 位以上随机字符串。没有这个密钥时 Worker 会拒绝写入，避免 D1 保存明文数据。
6. 部署 Worker 后，复制 Worker URL，例如 `https://daily-report-sync.xxx.workers.dev`。
7. 在 Vercel 项目 Environment Variables 里添加 `CLOUD_SYNC_ENDPOINT`，值填 Worker URL，然后重新部署。也可以用 `CLOUDFLARE_SYNC_URL` 或 `CLOUDFLARE_WORKER_URL`。
8. 成员打开原来的 Vercel 页面后会自动使用这个 Worker URL；如果需要临时覆盖，也可以在登录页“备用云同步地址”里手动填写。

Worker 提供 `/api/app-auth` 和 `/api/cloud-data`，会自动创建 `daily_report_cloud_state` 和 `daily_report_cloud_events` 两张 D1 表。写入 D1 的 `data` 字段是 AES-GCM 加密包；Worker 用 `CLOUD_SYNC_ENCRYPTION_KEY` 解密后再与前端同步。管理员可以在 Vercel 和 Cloudflare 两个云之间切换地址，必要时用“中心回灌云同步”或保存配置把本地中心写回当前选中的云同步通道。

## 云数据库备份（可选）

这个功能用于管理员额外保留备份快照，不会把数据库口令写进代码仓库，也不会缓存在浏览器本地。

1. 在实时云同步的基础上，额外添加环境变量 `CLOUD_BACKUP_TOKEN`。
2. 打开网页进入“管理员 / 同步与备份”，输入云备份口令后可以“检查云库”“备份到云数据库”“从云数据库恢复”。

云备份会额外自动创建：

- `daily_report_cloud_backups`：最近的备份快照列表。

云备份保存的是当前页面选择的数据视图：普通管理员保存当前文件夹；高级管理员切到“全部汇总”时保存汇总后的数据。

管理员还可以在“同步与备份”里刷新云端历史，选择最近的历史版本恢复。这个历史由实时同步自动产生，不需要成员额外操作。

## Vercel 数据安全

- `DATABASE_URL` / `POSTGRES_URL`、`TEAM_SYNC_TOKEN`、`APP_PASSWORD`、`CLOUD_BACKUP_TOKEN` 和 `CLOUD_SYNC_ENDPOINT` 只能配置在 Vercel Environment Variables，不要写入代码、README 或任何 JSON 数据文件。
- Cloudflare Worker 的 `CLOUD_SYNC_ENCRYPTION_KEY` 只能配置为 Worker Secret，不要配置到 Vercel，也不要发给成员。
- 团队实时同步接口只接受 `TEAM_SYNC_TOKEN` 或 `APP_PASSWORD`；云备份接口只接受 `CLOUD_BACKUP_TOKEN`，两类口令不再混用。
- 项目不再内置默认密码，首次使用前必须自行配置强口令。
- Vercel 响应默认 `no-store`，并附加 CSP、`nosniff`、`frame-ancestors 'none'` 等安全头，降低缓存、点击劫持和资源注入风险。
- Postgres 中保存的是应用数据 JSONB 和历史快照；数据库连接安全取决于 Vercel / Postgres 供应商账号、环境变量和数据库权限配置。

## 统计周期逻辑

- 混合表格是独立页签，默认跟随当前选中日期展示所在周，周一到周日。
- 整体预览的时间范围可切换“本周 / 小月度汇总 / 月度汇总 / 今日”，成员达标、项目合计和打卡查看都会跟随这个周期统计。
- 小月度汇总按结束月份归档：例如 `2026-04-14` 到 `2026-05-14` 算 `2026-05` 小月度汇总；`2026-05-30` 查看的是 `2026-05-14` 到 `2026-06-14` 的 `2026-06` 小月度汇总。
- 月度汇总也按结束月份归档：例如 `2026-04-23` 到 `2026-05-23` 算 `2026-05` 月度汇总；`2026-05-30` 查看的是 `2026-05-23` 到 `2026-06-23` 的 `2026-06` 月度汇总。
- 因此 `2026-05-30` 同时属于 `2026-06` 小月度汇总和 `2026-06` 月度汇总。后续新增“月度汇总”按钮时，沿用这个周期规则继续叠加，不覆盖已有汇总逻辑。

## 同步排查

如果有人说已经提交，但整体预览或总文件夹里看不到，优先检查这几件事：

- 顶部同步状态里 “Vercel 云库” 是否显示“已写入 Vercel 云库”或“已读取 Vercel 云库”。
- Vercel 是否配置了 `POSTGRES_URL` 或 `DATABASE_URL`，是否配置了 `TEAM_SYNC_TOKEN`，并且成员输入的应用密码是否等于 `TEAM_SYNC_TOKEN`。
- 如果 Vercel/Neon 额度满了，先部署 Cloudflare Worker + D1，把 Worker URL 配到 Vercel 的 `CLOUD_SYNC_ENDPOINT`，成员刷新后就能继续云端同步。
- 如果云同步显示“未配置加密密钥”，需要在 Cloudflare Worker Secret 里添加 `CLOUD_SYNC_ENCRYPTION_KEY` 并重新部署 Worker。
- 如果没有配置 Vercel 云同步，再由管理员检查是否在后台选择了团队共享的 Google Drive 本地同步文件夹。
- 如果 Vercel/Neon 提示流量额度满，先不要清浏览器缓存；管理员用“合并到管理员中心”和“中心写入共享”保底，额度恢复后再点“中心回灌云同步”。
- 管理员密码只解锁当前浏览器的管理员页面，不会把不同电脑变成同一份本地中心；跨电脑保底需要所有人选择同一个共享文件夹，或等待 Vercel 云同步恢复。
- 如果提示“未选择云端文件夹，也未写入 Vercel 云库”，这次只保存到了他自己的浏览器草稿。
- 所有人是否选择的是同一个共享文件夹，而不是各自电脑里的普通文件夹。
- Google Drive 桌面版是否已经完成同步。
- 总文件夹不会自动收到每个成员的提交；高级管理员需要“刷新来源数据”后点击“同步到汇总”。

当前推荐模式是“本地先保存，Vercel 正常时负责实时分发”。Google Drive/管理员本地中心作为灾备和二次汇总通道，避免云端额度、网络或供应商故障导致数据不可见。

## Vercel 部署

在 Vercel 导入 GitHub 仓库后使用这些设置：

- Framework Preset: Other
- Build Command: 留空
- Output Directory: `.`
- Install Command: `npm ci`
- Root Directory: 仓库根目录

本项目已经包含 `vercel.json` 和 `.vercelignore`，部署时只上传：

- `index.html`
- `app.js`
- `styles.css`
- `api/cloud-backup.js`
- `api/cloud-data.js`
- `vercel.json`
- `package.json`
- `package-lock.json`

## 本地打开

可以直接双击 `run_web_app.bat`，或用 Chrome / Edge 打开 `index.html`。

推荐浏览器：

- Chrome
- Microsoft Edge

原因是网页需要浏览器支持文件夹选择权限，才能直接读写 Google Drive 本地同步文件夹。

## 注意

- 首次使用前需要在 Vercel 配置 `APP_PASSWORD` 或 `TEAM_SYNC_TOKEN`；项目不再提供内置默认密码。
- 成员侧只需要填写报数和提交，不需要配置云端。
- 早中晚打卡默认留空，成员手动选择管理员配置的打卡选项后记录系统时间；系统不再自动判断准时或迟到，提交后进入人工审核。
- 整体预览可以按分组/成员查看项目明细和打卡情况。
- 混合表格位于顶部独立页签，默认按当前周查看，可直接编辑当前文件夹里的成员记录。
- 时区管理页可以添加 UTC 偏移，实时查看各地时间。
- 多台电脑同时打开同一天同一成员时，云同步会自动合并记录；空白草稿不会覆盖已有打卡或已有报数，早/中/晚打卡按各自时段保留更新内容。
- 同步数据会按记录内部的日期和成员重新归位，避免 `日期|成员` 存储 key 错位时把小云的内容显示到小诺卡片里。
- 管理员可以在后台修改密码、成员、项目、定额和审核文案。
- 管理员可以改名或删除分组，删除分组时成员会移动到其他分组。
- 管理员可以在后台查看云端历史版本，必要时恢复到某次自动保存或提交后的状态。
- 管理员可以在“同步与备份”里点击“提升高级管理员权限”，加载多个来源文件夹，按“当前文件夹 / 全部汇总 / 单个来源”切换整体预览。
- 高级管理员选择汇总文件夹后，可以把多个来源文件夹的 `report_data.json` 二次汇总写入总文件夹。
- 管理员本地中心可以合并来源副本、写入共享副本，并在 Vercel 恢复后回灌云库。
- 同一个共享文件夹内的 `daily_report_clients` 目录是分布式成员副本目录，每台电脑独立写入，管理员合并时会一起读取。
- 配置 `POSTGRES_URL` 或 `DATABASE_URL`，再配置 `TEAM_SYNC_TOKEN` 后，成员编辑记录会自动同步到 Vercel 云数据库，点击提交会立即同步。
- 填写 Cloudflare Worker 备用云地址后，成员编辑记录会同步到 Cloudflare D1，不再经过 Vercel Postgres。
- 配置 `CLOUD_BACKUP_TOKEN` 后，管理员可以把当前视图额外备份到云数据库，也可以从云备份恢复。
- 云备份口令只保存在当前页面内存里，不写入 `localStorage`。
- 汇总动作不会替换当前组文件夹数据，避免成员和组别被写回单个组文件夹后越积越乱。
- 整体预览的成员达标表按组折叠显示；效率分析明细使用顶部成员标签切换，避免一次展开所有成员。
- 多人协作时建议每个成员只编辑自己的记录。
- 如果两个人同时修改同一天同一成员记录，最后保存的人会覆盖该记录。

## GitHub 安全构建

仓库包含 `.github/workflows/release.yml`。推送 `v*` 标签后，GitHub Actions 会：

- 执行 `npm run check`
- 执行 `npm audit --audit-level=moderate`
- 打包静态网页 zip
- 使用 `actions/attest-build-provenance@v2` 生成构建证明
- 由 `github-actions[bot]` 创建 Release 并上传产物
