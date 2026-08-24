# Conversation Runtime v2 Evals

这组测试通过灵枢本地 HTTP API 比较对话质量、事实边界和高风险操作行为。`baseline-cases.js` 固化了 10 类 60 条 P0 样本。

运行前：

1. 使用 Node.js 24 启动开发工具环境。
2. 启动灵枢后端并确保端口为 `3005`。
3. 设置 `LINGSHU_EVAL_MODEL` 为已配置的 `provider/model`。
4. 运行 `npm run eval:conversation`，报告写入 `latest-report.json`。

本地完整报告不会上传全部长输出；趋势存储只保留每条输出的头尾摘要，避免超过 API 请求体限制。模型调用完成但趋势保存失败时，可运行 `npm run eval:conversation:save` 重试保存，不会再次调用模型。

需要 LLM rubric 评分时，可另行运行 `npx promptfoo@latest eval -c evals/conversation-runtime/promptfooconfig.yaml`。默认脚本不会自动产生 60 次付费模型调用，只有显式运行评测命令才会调用模型。

Promptfoo 只用于开发和 CI，不打包进 Electron 应用。

GitHub Actions 的 `Conversation Regression` 支持手动选择模型和样本数。真实模型任务只有在勾选 `run_live` 且在 `cost_approval` 中填写 `APPROVE` 后才会执行；协议测试和构建验证不会产生模型调用费用。
