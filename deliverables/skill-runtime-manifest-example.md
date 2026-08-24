# Skill Runtime Manifest 示例

灵枢默认把 Skill 当作“说明型 Skill”处理，只读取 `SKILL.md` 并注入本轮上下文。

如果某个 Skill 需要真实执行本地脚本，必须在 Skill 目录内新增 `lingshu.json` 或 `skill.json`，显式声明 runtime。没有 manifest 的 Skill 不会被自动执行。

## 最小示例

```json
{
  "runtime": {
    "command": "scripts/run.py",
    "args": [],
    "timeoutMs": 30000
  }
}
```

## 带参数示例

```json
{
  "runtime": {
    "command": "scripts/run.py",
    "timeoutMs": 30000,
    "permissions": {
      "skill.execution": {
        "label": "执行 Skill 入口",
        "level": "low",
        "description": "仅运行本 Skill 目录内声明的入口文件"
      },
      "files.read": {
        "label": "读取 Skill 目录",
        "level": "medium",
        "description": "读取本 Skill 目录内脚本和清单文件"
      }
    },
    "parameters": [
      {
        "name": "prefix",
        "label": "输出前缀",
        "type": "string",
        "required": true,
        "default": "Lingshu runtime smoke test passed."
      },
      {
        "name": "repeat",
        "label": "重复次数",
        "type": "integer",
        "default": 1
      },
      {
        "name": "style",
        "label": "输出风格",
        "type": "select",
        "default": "plain",
        "options": [
          { "label": "Plain", "value": "plain" },
          { "label": "JSON", "value": "json" }
        ]
      },
      {
        "name": "includeArguments",
        "label": "输出参数 JSON",
        "type": "boolean",
        "default": true
      },
      {
        "name": "metadata",
        "label": "元数据 JSON",
        "type": "json",
        "default": { "suite": "runtime-smoke", "schema": 1 }
      },
      {
        "name": "context",
        "label": "上下文对象",
        "type": "object",
        "default": { "source": "skills-test" }
      }
    ]
  }
}
```

Skills 管理页会根据 `parameters` 自动生成测试表单，并把填写内容作为 `arguments` 传给脚本。

## 参数类型与校验

当前支持的参数类型：

- `string` / `text`：文本输入。
- `number` / `integer`：数字输入，`integer` 必须是整数。
- `boolean`：开关输入。
- `select`：从 `options` 中选择，提交前会校验选项值。
- `json`：合法 JSON，可为对象、数组、字符串、数字或布尔值。
- `object`：合法 JSON 对象，不能是数组。
- `file`：文件路径占位类型，当前以文本路径输入为主。

校验规则：

- `required: true` 的参数为空时不会启动脚本。
- 有 `default` 的参数在缺省时使用默认值。
- JSON/Object 会在执行前解析为真实对象，脚本收到的 `arguments` 不再是未解析字符串。

## 权限声明

`runtime.permissions` 用于声明 Skill 期望使用的能力。灵枢当前会在 Skills 页面和 Run History 中展示这些权限，后续会用于执行前确认和隔离策略。

建议权限 key：

- `skill.execution`：执行当前 Skill 目录内入口。
- `files.read` / `files.write`：读取或写入文件。
- `network`：访问网络。
- `shell`：需要 shell/系统命令能力。
- `env`：读取环境变量。

`level` 可填 `low`、`medium`、`high`。未填写时灵枢会根据 key 做基础推断。

## 运行约定

- `command` / `entry` 必须指向 Skill 目录内的文件。
- 支持 `.py`、`.js`、`.cjs`、`.mjs`、`.sh`，以及可执行文件。
- 脚本工作目录是当前 Skill 目录。
- 标准输入会收到 JSON：

```json
{
  "message": "用户本轮输入",
  "arguments": {
    "prefix": "Lingshu runtime smoke test passed.",
    "repeat": 1
  }
}
```

- 同时会注入环境变量：
  - `LINGSHU_SKILL_ID`
  - `LINGSHU_SKILL_NAME`
  - `LINGSHU_SKILL_INPUT`
  - `LINGSHU_SKILL_ARGUMENTS`

## 返回约定

脚本把结果写到 stdout。灵枢会把 stdout/stderr、耗时、退出码、参数和权限声明记录进 toolCall 与 Run History：

- manifest 不存在：`mode = prompt-only`
- manifest 可执行：`mode = runtime`
- manifest 无法解析或入口非法：`mode = manifest-error`

## Python 示例

```python
#!/usr/bin/env python3
import json
import sys

payload = json.load(sys.stdin)
message = payload.get("message", "")

print(f"已处理输入：{message}")
```

## 可运行样例

仓库内已提供一个最小可执行样例：

```text
deliverables/sample-skills/lingshu-runtime-smoke/
  SKILL.md
  lingshu.json
  scripts/run.py
```

安装后在 Skills 管理页会显示为 `可执行`，测试执行会返回 `mode = runtime`。
