# 安全预检记录

预检日期：2026-05-24

## 当前状态

- 项目类型：Electron Windows 桌面应用
- 本地敏感扫描：未发现 GitHub Token、API Key、云端记录文件或桌面路径配置文件
- 本地依赖审计：`npm audit` 通过，0 个漏洞
- 本地语法检查：`npm run check` 通过
- 本地 Windows 构建：`npm run build:win` 通过
- GitHub MCP：当前环境未提供，无法自动创建仓库、开启扫描或验证 Release Attestation

## 已配置

- `.gitignore` 已排除本地记录、云端配置、备份、缓存、依赖目录和构建产物
- `.github/workflows/release.yml` 已配置 tag 发布构建：
  - tag 触发：`v*`
  - 权限：`id-token: write`、`contents: write`、`attestations: write`
  - Windows 构建：`npm run build:win`
  - Release asset：`release-assets/*`
  - Attestation：`actions/attest-build-provenance@v2`
- `.github/workflows/codeql.yml` 已配置 JavaScript/TypeScript CodeQL 扫描

## GitHub 发布步骤

1. 在 GitHub 创建公开仓库。
2. 将 `推送1.0` 文件夹内的内容作为仓库根目录推送。
3. 在仓库 Settings 中确认启用：
   - Secret scanning
   - Dependabot alerts
   - Dependabot security updates
   - Code scanning
4. 推送 tag 触发 Release：

```bash
git tag -a v1.0.0 -m "Release version 1.0.0"
git push origin v1.0.0
```

5. 等待 GitHub Actions 成功后，在 Release 页面确认安装包由 `github-actions[bot]` 上传并带有 Verified / Attestation。

## 同步逻辑说明

软件交给别人后，对方第一次打开输入默认密码 `999`，点击“云端文件夹”，选择你共享给他的 Google Drive 本地同步文件夹。只要大家选择的是同一个共享文件夹，软件会使用同一个 `report_data.json` 同步数据。

注意：Google Drive 本地文件夹同步适合多人协作，但不是数据库级实时锁。建议每个人只编辑自己的成员记录；管理员统一改配置后点击保存配置。
