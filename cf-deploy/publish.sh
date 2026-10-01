#!/usr/bin/env bash
# 写完文章后跑这一条：导入新文章 → 构建 → 部署上线
#
# 用法：bash cf-deploy/publish.sh
#   SKIP_REVIEW=1  bash cf-deploy/publish.sh   跳过「摘要待润色」的确认
#
# 只上线、不导入新文章时，用 bash cf-deploy/deploy.sh。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "==> 导入写作端新文章"
node cf-deploy/import-posts.mjs

# 摘要是文章在首页、搜索、RSS 与三维档案卡片上的门面，脚本只能草拟。
if grep -rlq "摘要待润色" content/posts 2>/dev/null; then
  echo
  echo "⚠️ 以下文章的摘要还是自动草拟的，建议先润色再上线："
  grep -rl "摘要待润色" content/posts | sed 's/^/    /'
  echo
  if [[ -n "${SKIP_REVIEW:-}" ]]; then
    echo "SKIP_REVIEW=1：跳过确认，直接部署。"
  else
    read -r -p "仍要继续部署？[y/N] " answer
    if [[ ! "$answer" =~ ^[Yy]$ ]]; then
      echo "已取消。改完 description 再跑一次。"
      exit 1
    fi
  fi
fi

bash cf-deploy/deploy.sh
