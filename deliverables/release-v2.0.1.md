# 灵枢 V2.0.1

V2.0.1 是桌面发布工程更新，重点补齐应用身份、版本一致性和后续增量升级能力。

## 本次更新

- “关于”页改为读取真实应用版本，并修正 GitHub 与问题反馈地址。
- 新增应用内更新检查、手动下载、下载进度和重启安装流程。
- GitHub Release 新增 `latest.yml`、`latest-mac.yml` 和差分更新 `blockmap` 元数据。
- 发布流水线支持 macOS Developer ID 签名、Apple notarization 与 Windows 代码签名。
- 真实模型回归评测新增显式费用确认、样本数和模型选择参数。
- 移除 Chromium 全局 `--no-sandbox` 启动参数。

## 更新策略

灵枢启动后只检查是否有新版本，不会自动下载或静默安装。发现新版本后，需要在“设置 > 关于”中确认下载；下载完成后，再由用户确认重启安装。

## 签名配置

仓库未保存任何证书或密码。维护者可在 GitHub Actions Secrets 中配置：

- macOS：`MAC_CSC_LINK`、`MAC_CSC_KEY_PASSWORD`、`APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID`
- Windows：`WIN_CSC_LINK`、`WIN_CSC_KEY_PASSWORD`

未配置凭证时流水线仍会生成未签名安装包，并在构建日志中明确标记跳过签名和公证。

## 说明

- 自动更新依赖 GitHub Releases 网络可用。
- macOS 的无警告安装和可靠增量更新需要 Developer ID 签名及 Apple notarization。
- 本地真实模型评测会产生调用费用，只有手动触发并填写 `APPROVE` 后才会运行。
