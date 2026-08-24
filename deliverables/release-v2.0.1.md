# 灵枢 V2.0.1

V2.0.1 是桌面发布工程更新，重点补齐应用身份、版本一致性和后续增量升级能力。

## 本次更新

- “关于”页改为读取真实应用版本，并修正 GitHub 与问题反馈地址。
- 新增应用内更新检查、手动下载、下载进度和重启安装流程。
- GitHub Release 新增 `latest.yml`、`latest-mac.yml` 和差分更新 `blockmap` 元数据。
- 发布流水线支持 macOS Developer ID 签名、Apple notarization 与 Windows 代码签名。
- 真实模型回归评测新增显式费用确认、样本数和模型选择参数。
- 移除 Chromium 全局 `--no-sandbox` 启动参数。
- React Router 升级到 7.18.2，node-cron 升级到 4.6.0，生产依赖审计清零。
- DeepSeek V4 Flash 完成 60 条真实评测，59 条通过，通过率 98.33%，质量门槛通过。
- 发布工作流新增 Apple/Windows 独立签名预检、构建后验签和更新元数据完整性校验。
- 修复旧版 Release 未上传 `latest-mac.yml`、`latest.yml` 与 blockmap 导致的应用内更新失败。
- Electron 升级到 43.4.1、electron-builder 升级到 26.15.3、Vite 升级到 8.2.2，完整依赖审计清零。

## 更新策略

灵枢启动后只检查是否有新版本，不会自动下载或静默安装。发现新版本后，需要在“设置 > 关于”中确认下载；下载完成后，再由用户确认重启安装。

## 签名配置

仓库未保存任何证书或密码。维护者可在 GitHub Actions Secrets 中配置：

- macOS：`MAC_CSC_LINK`、`MAC_CSC_KEY_PASSWORD`、`APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID`
- Windows：`WIN_CSC_LINK`、`WIN_CSC_KEY_PASSWORD`

正式 Tag 发布必须配置以上全部凭证；缺少任意一项时，发布流水线会在构建前失败，不再生成未签名正式安装包。

## 说明

- 自动更新依赖 GitHub Releases 网络可用。
- macOS 的无警告安装和可靠增量更新需要 Developer ID 签名及 Apple notarization。
- 本地真实模型评测会产生调用费用，只有手动触发并填写 `APPROVE` 后才会运行。
