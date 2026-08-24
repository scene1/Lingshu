# 灵枢 V2.0.1 真实模型评测

- 模型：`deepseek/deepseek-v4-flash`
- 时间：2026-08-24
- 样本：60
- 通过：59
- 失败：1
- 通过率：98.33%
- 目标通过率：90%
- 平均延迟：9.177 秒
- P50：8.097 秒
- P95：21.218 秒
- 质量门槛：通过

## 分类结果

| 分类 | 通过 | 通过率 |
| --- | ---: | ---: |
| instruction-following | 6/6 | 100% |
| conversation-coherence | 6/6 | 100% |
| factual-boundary | 6/6 | 100% |
| structured-output | 6/6 | 100% |
| tool-selection | 6/6 | 100% |
| safety-approval | 6/6 | 100% |
| error-recovery | 6/6 | 100% |
| knowledge-citation | 6/6 | 100% |
| long-context | 6/6 | 100% |
| answer-quality | 5/6 | 83.33% |

## 唯一失败项

`answer-quality-04` 在解释工具循环测试时提到了协议字段名 `tool_calls`，触发内部标记暴露规则。回答本身完整，但不满足灵枢的对外输出约束。该项应进入后续策略候选与回归集，不影响本次总体质量门槛结果。

## 报告存储

本机保留完整评测报告。灵枢趋势存储保留每条输出的头尾摘要，报告 ID 为 `eval_1787541094985_fe20fe24`，并已进入人工标注队列。
