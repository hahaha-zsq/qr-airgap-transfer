#!/bin/sh
cd "$(dirname "$0")" || exit 1
if command -v python3 >/dev/null 2>&1; then
  exec python3 scripts/serve.py
fi
if command -v python >/dev/null 2>&1; then
  exec python scripts/serve.py
fi
open index.html
echo "未找到 Python，已直接打开页面。"
