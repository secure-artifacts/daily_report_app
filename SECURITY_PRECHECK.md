# 安全预检记录

预检日期：2026-05-26

## 当前部署形态

- Vercel 部署网页代码和可选云备份 API。
- 未配置云数据库时，报数数据不上传 Vercel，不写入仓库。
- 团队数据保存在成员共同选择的 Google Drive 本地同步文件夹里。
- 数据文件名：`report_data.json`。
- 配置 `DATABASE_URL` 和 `CLOUD_BACKUP_TOKEN` 后，管理员可把当前数据视图备份到 Postgres。

## 已处理

- `.gitignore` 排除本地数据、备份、日志、密钥和构建产物。
- `.vercelignore` 只允许 Vercel 上传网页和 API 必需文件。
- `vercel.json` 设置无构建命令，并对所有响应设置 `Cache-Control: no-store`。
- 本地语法检查使用 `npm run check`。
- `.github/workflows/code-audit.yml` 执行语法检查和 `npm audit`。
- `.github/workflows/codeql.yml` 执行 JavaScript/TypeScript CodeQL 扫描。
- `.github/workflows/release.yml` 在 tag `v*` 上打包 Release zip，并使用 `actions/attest-build-provenance@v2` 生成安全构建证明。
- 高级管理员汇总功能只读取用户显式选择的来源文件夹和汇总文件夹，不会扫描任意本地目录。
- 未选择云端文件夹时，提交不会再提示“已同步云端”，避免本地草稿被误认为团队数据。
- 云数据库备份 API 使用 `DATABASE_URL` 连接数据库，使用 `CLOUD_BACKUP_TOKEN` 做服务端口令校验；口令不写入仓库，不持久化到浏览器。
- 云数据库备份使用参数化 SQL 写入 JSONB，避免拼接 SQL。
- 云备份接口对响应设置 `no-store`，并限制单次请求体 8MB。

## GitHub 预检结果

- 目标仓库：`secure-artifacts/daily_report_app`
- 推送分支：`main`
- 最新提交：`1a404a08d4d840d82a36701db67a3fe65dc5a3ee`
- Release 标签：`v2.0.2`
- Release 页面：https://github.com/secure-artifacts/daily_report_app/releases/tag/v2.0.2
- Release 创建者：`github-actions[bot]`
- Release 资产：`daily-report-app-v2.0.2.zip`
- Release 资产 SHA-256：`2bdc1013e60e4abf74ffc69549fc403826953388c85a284916fcb7c6ba0a9a10`
- 构建证明：GitHub Attestations API 已返回 provenance bundle，predicate type 为 `https://slsa.dev/provenance/v1`。

## GitHub Actions 结果

- Code Audit：成功  
  https://github.com/secure-artifacts/daily_report_app/actions/runs/26398711767
- Build and Release：成功  
  https://github.com/secure-artifacts/daily_report_app/actions/runs/26398711768
- CodeQL：成功  
  https://github.com/secure-artifacts/daily_report_app/actions/runs/26398698125

## 告警查询状态

以下 GitHub 安全告警 API 使用匿名访问会返回 401，需要仓库权限 Token 或在 GitHub 页面中查看：

- Code scanning alerts
- Secret scanning alerts
- Dependabot alerts

已完成的替代验证：

- CodeQL workflow 成功执行。
- `npm audit --audit-level=moderate` 本地和 CI 均通过。
- Release 产物由 GitHub Actions bot 上传。
- Release 产物已生成 SLSA provenance 构建证明。

## 本次功能变更审计

- 新增 Vercel API：`api/cloud-backup.js`。
- 新增云数据库备份/恢复界面，管理员需要输入云备份口令后才能操作。
- 云数据库自动维护最新快照和最近快照列表。
- 云备份口令只在当前页面内存中使用，不写入 `localStorage`。
- 新增“提升高级管理员权限”，需要重新输入管理员密码。
- 高级管理员可加载多个来源文件夹，切换当前文件夹、全部汇总或单个来源文件夹查看。
- 汇总写入只写到用户选择的汇总文件夹 `report_data.json`。
- 汇总后不再把当前工作数据替换成汇总数据，避免再次保存时把总数据写回单个组文件夹。
- 整体预览按组折叠展示，降低信息过载。
- 效率分析明细改为顶部成员标签切换，不再一次性展开所有成员明细。

## 注意

浏览器端直接选择文件夹需要 Chrome / Edge 支持 File System Access API。Vercel 不能代替用户读取 Google Drive 账号，也不会保存 Google Drive 内部数据。
