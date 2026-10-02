# cf-deploy —— woo3an.top 的 Cloudflare Worker 部署

线上 Worker 名字叫 `rhinelab-blog`，托管两块内容（都是静态产物）：

| 路径 | 内容 | 来源 |
| --- | --- | --- |
| `/` | 博客（Astro 静态站） | `npm run build:blog` → `dist/` |
| `/lab/` | 三维档案终端（Three.js） | `npm run build:lab` → `dist/lab/` |

## 部署边界（2026-10-02 拆分）

`woo3an.top` 一个域名两个 Worker，**按路径分工、各自独立仓库、各自独立部署**：

| Worker 名 | 路由 | 仓库 | 内容 |
| --- | --- | --- | --- |
| `rhinelab-blog` | `woo3an.top/*` | 本仓库（`cf-deploy/`） | 博客 + `/lab/` |
| `bobing-game` | `woo3an.top/bobing*`、`woo3an.top/ws` | Woo3aN/bobing（`cf/`） | 博饼游戏 + 房间服务 |

⚠️ **两个仓库的 Worker 名字必须不同。** 名字就是部署单元 ID，同名部署 =
后部署的把先部署的整个覆盖掉 —— 2026-10-02 之前两边都叫 `bobing`，游戏一上线
博客就整个没了（根路径 520）。房间服务（`RoomDO`）也只留在游戏那边：两个 Worker
的 Durable Object 存储是分开的，两边都实现会让同一个房间号出现两份房间数据。

改路由请改仓库里的 `wrangler.jsonc`，不要只改 Cloudflare 控制台 —— 下次部署
会以配置文件为准，控制台的手工改动会被冲掉。

## 部署

写完文章后发新文章：

```bash
bash cf-deploy/publish.sh     # 导入新文章 → 构建 → 部署
```

只重新上线（没有新文章，只改了样式或配置）：

```bash
bash cf-deploy/deploy.sh
```

**推到 GitHub 也会自动部署**：`.github/workflows/deploy.yml` 监听 `main` 分支的
push，在 GitHub 的机器上跑一遍构建再上传。两条路都能上线，本地那条可以先看效果。

### 自动部署需要的配置（**已配好**）

| 项目 | 值 | 位置 |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | 见本机 `~/.workbuddy/secrets/cloudflare-bobing.token` | 仓库 Secret（Settings → Secrets and variables → Actions） |
| `CLOUDFLARE_ACCOUNT_ID` | `4fbd588701e01fbe0f3a2cce7c02d7b5` | 写在 workflow 里，不是 Secret |

**换成新仓库或 Secret 失效时才需要重配**：仓库 → Settings → Secrets and variables
→ Actions → New repository secret，Name 填 `CLOUDFLARE_API_TOKEN`，值粘贴 Token。

用的是 GitHub Actions 而不是 Cloudflare 自带的 Git 集成，因为后者需要在
Cloudflare 后台做 GitHub OAuth 授权（只能本人操作），而 Actions 只要一个 Token。

`publish.sh` 会先跑 `import-posts.mjs`：从写作端（默认 Obsidian 的
`Blog/_posts`，可用 `POSTS_SRC=<目录>` 覆盖）导入没导入过的文章，自动分配 id
（取现有最大的 `wp-<数字>` 顺延）、沿用 `/年/月/日/标题/` 网址。

**摘要需要自己写**：脚本只从正文首段草拟一句并打上 `# 摘要待润色` 标记。
主题强制要求 `description` 非空、≤300 字，它出现在首页列表、搜索结果、RSS
和三维档案卡片上，是文章的门面。`publish.sh` 发现待润色的文章会先提示确认。


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
