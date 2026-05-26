# 小组报数日记

这是一个可以部署到 Vercel 的网页版本。默认仍然支持成员在浏览器里选择同一个 Google Drive 桌面版同步文件夹来读写；如果在 Vercel 配置云数据库，也可以由管理员把当前数据或汇总数据备份到云数据库。

## 数据同步方式

1. 团队负责人在 Google Drive 里创建一个共享文件夹。
2. 每个成员电脑安装 Google Drive 桌面版，并同步这个共享文件夹。
3. 打开网页后点击“云端文件夹”。
4. 选择本机 Google Drive 里的同一个共享文件夹。
5. 应用会在该文件夹里创建或读取 `report_data.json`。

未配置云数据库时，Vercel 不保存报数记录，不上传内部数据文件。数据文件仍在 Google Drive 共享文件夹里。

## 云数据库备份（可选）

这个功能用于管理员备份和恢复数据快照，不会把数据库口令写进代码仓库，也不会缓存在浏览器本地。

1. 在 Vercel Marketplace 里给项目添加 Postgres 数据库，推荐 Neon 或 Supabase Postgres。
2. 确认 Vercel 项目环境变量里有 `DATABASE_URL`。
3. 额外添加一个环境变量 `CLOUD_BACKUP_TOKEN`，作为管理员云备份口令。
4. 重新部署 Vercel。
5. 打开网页进入“管理员 / 同步与备份”，输入云备份口令后可以“检查云库”“备份到云数据库”“从云数据库恢复”。

云数据库会自动创建两张表：

- `daily_report_cloud_backups`：最近的备份快照列表。
- `daily_report_cloud_state`：最新快照，方便一键恢复。

云备份保存的是当前页面选择的数据视图：普通管理员保存当前文件夹；高级管理员切到“全部汇总”时保存汇总后的数据。

## 同步排查

如果有人说已经提交，但整体预览或总文件夹里看不到，优先检查这几件事：

- 他是否点击过“云端文件夹”，并选择了团队共享的 Google Drive 本地同步文件夹。
- 顶部同步状态是否显示“已写入云端”；如果提示“未选择云端文件夹”，这次只保存到了他自己的浏览器草稿。
- 所有人是否选择的是同一个共享文件夹，而不是各自电脑里的普通文件夹。
- Google Drive 桌面版是否已经完成同步。
- 总文件夹不会自动收到每个成员的提交；高级管理员需要“刷新来源数据”后点击“同步到汇总”。

当前模式适合先用 Google Drive 做团队同步，再用云数据库做管理员备份。如果要做到所有人提交后总后台立刻自动更新，需要继续升级成“每次提交直接写数据库”的服务端 API 模式。

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

- 首次使用需要输入默认密码 `999`。
- 管理员可以在后台修改密码、成员、项目、定额和审核文案。
- 管理员可以在“同步与备份”里点击“提升高级管理员权限”，加载多个来源文件夹，按“当前文件夹 / 全部汇总 / 单个来源”切换整体预览。
- 高级管理员选择汇总文件夹后，可以把多个来源文件夹的 `report_data.json` 二次汇总写入总文件夹。
- 配置 `DATABASE_URL` 和 `CLOUD_BACKUP_TOKEN` 后，管理员可以把当前视图备份到云数据库，也可以从云数据库恢复。
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
