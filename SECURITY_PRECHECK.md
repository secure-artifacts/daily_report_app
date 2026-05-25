# 安全预检记录

预检日期：2026-05-25

## 当前部署形态

- Vercel 只部署静态网页代码。
- 报数数据不上传 Vercel，不写入仓库。
- 团队数据保存在成员共同选择的 Google Drive 本地同步文件夹里。
- 数据文件名：`report_data.json`。

## 已处理

- `.gitignore` 排除本地数据、备份、日志、密钥和构建产物。
- `.vercelignore` 只允许 Vercel 上传静态网页必需文件。
- `vercel.json` 设置静态部署，无构建命令。
- 本地语法检查使用 `npm run check`。
- `.github/workflows/code-audit.yml` 执行语法检查和 `npm audit`。
- `.github/workflows/codeql.yml` 执行 JavaScript/TypeScript CodeQL 扫描。
- `.github/workflows/release.yml` 在 tag `v*` 上打包 Release zip，并使用 `actions/attest-build-provenance@v2` 生成安全构建证明。
- 高级管理员汇总功能只读取用户显式选择的来源文件夹和汇总文件夹，不会扫描任意本地目录。

## GitHub 预检结果

- 目标仓库：`secure-artifacts/daily_report_app`
- 推送分支：`main`
- 最新提交：`fe9243db31384b8f83e3ebf5c9f7485fbfcc843d`
- Release 标签：`v2.0.1`
- Release 页面：https://github.com/secure-artifacts/daily_report_app/releases/tag/v2.0.1
- Release 创建者：`github-actions[bot]`
- Release 资产：`daily-report-app-v2.0.1.zip`
- Release 资产 SHA-256：`7701861644dadd7ffcf3e3374160cc13773c9981519c768631177f4bcf8e02ef`
- 构建证明：GitHub Attestations API 已返回 provenance bundle，predicate type 为 `https://slsa.dev/provenance/v1`。

## GitHub Actions 结果

- Code Audit：成功  
  https://github.com/secure-artifacts/daily_report_app/actions/runs/26397926567
- Build and Release：成功  
  https://github.com/secure-artifacts/daily_report_app/actions/runs/26397926488
- CodeQL：成功  
  https://github.com/secure-artifacts/daily_report_app/actions/runs/26397913454

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

- 新增“提升高级管理员权限”，需要重新输入管理员密码。
- 高级管理员可加载多个来源文件夹，切换当前文件夹、全部汇总或单个来源文件夹查看。
- 汇总写入只写到用户选择的汇总文件夹 `report_data.json`。
- 整体预览按组折叠展示，降低信息过载。
- 效率分析明细改为顶部成员标签切换，不再一次性展开所有成员明细。

## 注意

浏览器端直接选择文件夹需要 Chrome / Edge 支持 File System Access API。Vercel 不能代替用户读取 Google Drive 账号，也不会保存 Google Drive 内部数据。
