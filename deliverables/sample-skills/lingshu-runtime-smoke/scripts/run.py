#!/usr/bin/env python3
import json
import os
import sys


def main():
    try:
        payload = json.load(sys.stdin)
    except Exception:
        payload = {}

    message = payload.get("message") or os.environ.get("LINGSHU_SKILL_INPUT", "")
    arguments = payload.get("arguments") or {}
    prefix = arguments.get("prefix") or "Lingshu runtime smoke test passed."
    try:
        repeat = max(1, min(int(arguments.get("repeat", 1)), 5))
    except Exception:
        repeat = 1
    style = arguments.get("style") or "plain"
    include_arguments = bool(arguments.get("includeArguments", True))

    if style == "json":
        print(json.dumps({
            "ok": True,
            "skill_id": os.environ.get("LINGSHU_SKILL_ID", ""),
            "message": message,
            "repeat": repeat,
            "arguments": arguments if include_arguments else None,
        }, ensure_ascii=False))
        return

    print(prefix)
    print(f"skill_id={os.environ.get('LINGSHU_SKILL_ID', '')}")
    for index in range(repeat):
        print(f"message[{index + 1}]={message}")
    if include_arguments:
        print(f"arguments={json.dumps(arguments, ensure_ascii=False)}")


if __name__ == "__main__":
    main()
