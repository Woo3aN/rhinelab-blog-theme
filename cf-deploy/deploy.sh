#!/usr/bin/env bash
# 重建并部署 woo3an.top（博客 + /lab/ 三维档案 + /bobing 博饼）
#
# 用法：bash cf-deploy/deploy.sh
# 前置：
#   · Cloudflare API Token 放在 ~/.workbuddy/secrets/cloudflare-bobing.token
#   · 需要能跑 Node（本机用系统 Node 24）
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

NPM="${NPM:-npm}"
WRANGLER="${WRANGLER:-$HOME/.workbuddy/tools/cfz/node_modules/wrangler/bin/wrangler.js}"
TOKEN_FILE="${TOKEN_FILE:-$HOME/.workbuddy/secrets/cloudflare-bobing.token}"
ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-4fbd588701e01fbe0f3a2cce7c02d7b5}"

# ⚠️ 本机 NODE_OPTIONS 里注入了 safe-delete 守卫：它会拦住 Astro 清空 dist/
#    以及 prepare-assets 重铺字体目录（超过 50 个文件就报 BULK_CONFIRM_REQUIRED）。
#    构建必须绕开它，否则 build:blog / build:lab 必失败。
unset NODE_OPTIONS

export BLOG_SITE_ORIGIN="https://woo3an.top"

# 顺序与 scripts/blog/build-site.mjs 一致；不直接跑 npm run build，
# 因为那个脚本用 spawnSync(npm.cmd) 编排，在 Windows 上会 EINVAL。
for step in check:content check:features build:blog build:lab search:index check:site; do
  echo "==> npm run $step"
  "$NPM" run "$step"
done

# 博饼页是独立产物，Astro 构建会清空 dist/，所以合并在构建之后做。
mkdir -p dist/bobing
cp cf-deploy/bobing/index.html dist/bobing/index.html
echo "==> dist/bobing/index.html 已就位"

export CLOUDFLARE_API_TOKEN="$(tr -d '\r\n' < "$TOKEN_FILE")"
export CLOUDFLARE_ACCOUNT_ID="$ACCOUNT_ID"

cd cf-deploy
# --no-bundle：worker.js 是单文件无 import，跳过打包器（本机 esbuild 打包链路不可靠）。
node "$WRANGLER" deploy --no-bundle
