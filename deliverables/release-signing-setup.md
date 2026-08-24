# 灵枢正式发布签名配置

`Release` workflow 分别检查 macOS 与 Windows 签名凭证。任一平台凭证缺失、验签失败或更新元数据不完整，都会终止正式发布。

签名凭证只能放在 GitHub Actions Secrets 中，不应写入 `.env`、脚本参数、提交记录或聊天内容。

## 快速配置

先准备两个由受信任机构签发、且包含私钥的证书文件：

- macOS：Apple Developer Program 导出的 `Developer ID Application` `.p12`
- Windows：受信任 CA 签发的代码签名 `.pfx/.p12`

在仓库根目录运行：

```bash
npm run release:signing:status
npm run release:signing:configure -- all
```

也可以只配置一个平台：

```bash
npm run release:signing:configure -- macos
npm run release:signing:configure -- windows
```

脚本会在终端中隐藏密码输入，校验证书格式和密码，并通过标准输入写入 GitHub Secrets。证书内容和密码不会落盘，也不会出现在 `gh` 命令参数中。

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

配置后先确认七项均显示为 `configured`：

```bash
npm run release:signing:status
```

再推送版本 Tag。构建成功标准：

- macOS 日志出现 Developer ID 签名和 Apple notarization 成功记录
- `codesign --verify --deep --strict` 通过
- `spctl --assess --type execute` 通过
- Windows 安装包 Authenticode 状态为 `Valid`
- GitHub Release 同时包含安装包、ZIP、更新元数据、blockmap 和 SHA256 校验文件

发布任务会在上传 Release 前解析并校验：

- `latest-mac.yml` 同时包含 arm64 与 x64 ZIP，文件大小和 SHA512 与实际资产一致
- `latest.yml` 指向已签名的 Windows 安装包，文件大小和 SHA512 一致
- macOS ZIP 与 Windows 安装包均包含对应 `.blockmap`

本地或 CI 也可以手动检查已汇总的发布目录：

```bash
npm run release:assets:verify -- --dir release-assets --version 2.0.1
```

本机只构建了一个平台时，可以附加 `--platform macos` 或 `--platform windows`；正式发布任务始终使用默认的 `all`。

## 当前状态

截至 2026-08-24，`scene1/Lingshu` 尚未配置上述七项 Secrets，本机钥匙串也没有可用代码签名身份。必须先从 Apple Developer 与 Windows 证书颁发机构取得真实证书，不能用自签名证书替代正式发布签名。

`v2.0.0` Release 缺少 `latest-mac.yml`、`latest.yml` 和 blockmap，因此旧版更新器会提示元数据缺失。`v2.0.1` 工作流已经强制生成并校验这些文件；正式签名 Release 发布后，应用内检查更新会恢复正常。
