# 灵枢正式发布签名配置

`Release` workflow 在构建前检查全部签名凭证。任何凭证缺失都会终止正式发布。

## macOS

需要 Apple Developer Program 中的 `Developer ID Application` 证书，以及用于 notarization 的 Apple ID 凭证。

在 GitHub Actions Secrets 中配置：

- `MAC_CSC_LINK`：导出的 `.p12` 文件 Base64 内容或受支持的私有下载地址
- `MAC_CSC_KEY_PASSWORD`：`.p12` 导出密码
- `APPLE_ID`：用于 notarization 的 Apple ID
- `APPLE_APP_SPECIFIC_PASSWORD`：Apple ID 专用密码
- `APPLE_TEAM_ID`：Apple Developer Team ID

## Windows

需要受信任 CA 签发的代码签名证书，推荐 EV 或云签名证书。

在 GitHub Actions Secrets 中配置：

- `WIN_CSC_LINK`：`.pfx/.p12` 文件 Base64 内容或受支持的私有下载地址
- `WIN_CSC_KEY_PASSWORD`：证书密码

## 验证

配置凭证后，推送版本 Tag。构建成功标准：

- macOS 日志出现 Developer ID 签名和 Apple notarization 成功记录
- `codesign --verify --deep --strict` 通过
- `spctl --assess --type execute` 通过
- Windows 安装包 Authenticode 状态为 `Valid`
- GitHub Release 同时包含安装包、ZIP、更新元数据、blockmap 和 SHA256 校验文件
