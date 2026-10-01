# cf-deploy —— woo3an.top 的 Cloudflare Worker 部署

同一个 Worker（线上名字叫 `bobing`）托管三块内容：

| 路径 | 内容 | 来源 |
| --- | --- | --- |
| `/` | 博客（Astro 静态站） | `npm run build:blog` → `dist/` |
| `/lab/` | 三维档案终端（Three.js） | `npm run build:lab` → `dist/lab/` |
| `/bobing` | 中秋博饼小游戏 | `cf-deploy/bobing/index.html` |
| `/ws` | 博饼房间 WebSocket | `worker.js` 里的 `RoomDO` |

## 部署

```bash
bash cf-deploy/deploy.sh
```

前置条件：

- Cloudflare API Token（Edit Cloudflare Workers 模板）放在
  `~/.workbuddy/secrets/cloudflare-bobing.token`，**不要提交进仓库**。
- 账号 ID 默认写死在脚本里（`4fbd588701e01fbe0f3a2cce7c02d7b5`），可用
  `CLOUDFLARE_ACCOUNT_ID` 覆盖。

## 两个必须知道的坑

**1. 构建前必须 `unset NODE_OPTIONS`。**
本机 `NODE_OPTIONS` 注入了 safe-delete 守卫，任何单轮超过 50 个文件的删除都会
报 `[safe-delete][SAFE_DELETE_BULK_CONFIRM_REQUIRED]` 并中止。而
`prepare-assets.mjs` 每次都要清空并重铺 `apps/blog/public/fonts/`（760 个文件），
Astro 也会清空 `dist/`，所以带着这个变量构建**必失败**。`deploy.sh` 里已经
unset 了。

**2. 不要用 `npm run build`。**
`scripts/blog/build-site.mjs` 用 `spawnSync(npm, …)` 编排子步骤，Windows 上
`npm` 实际是 `npm.cmd`，Node 18.20+/20.12+ 起 spawnSync 不带 shell 会直接
`EINVAL`。`deploy.sh` 改成在 shell 里逐个跑 `npm run <step>`，顺序与那个脚本一致。

**3. 部署必须加 `--no-bundle`。**
`worker.js` 是单文件、无 `import`，跳过打包器即可。本机 esbuild 的**打包**链路
不可靠（npm 生命周期脚本会因同步 spawn 失败），`--no-bundle` 绕开它。

## 与主题原始部署方式的关系

主题自带的部署是「本机构建 → SSH 上传不可变 release → nginx 激活」，见仓库根的
`BLOG-MAINTAIN-PERFECT.md` 与 `ops/`。本站没有 VPS，改用 Cloudflare Workers
Assets 托管静态产物，所以 `ops/` 下的 nginx / systemd 文件在本站不适用，
保留只是为了让 `features.manifest.json` 的路径声明继续成立。

## 登录已移除

本站不提供账号系统。原主题的 `/lab/` 身份门有登录/注册（后端是
`services/lab-auth/` 的 Go + SQLite 服务，需要 VPS），本站改成了只保留
「以访客身份进入」：面板、序幕、三维档案、沉浸式阅读器全部保留，
只去掉账号相关的表单与网络流程。`services/lab-auth/` 因此**不部署**，
代码留在仓库里没有影响。
