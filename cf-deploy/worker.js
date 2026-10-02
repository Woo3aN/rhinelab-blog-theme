/**
 * woo3an.top —— 博客（Astro 静态站）+ 三维档案终端（/lab/）
 * ---------------------------------------------------------------------------
 * 纯静态站：所有请求直接交给 Workers Assets，Worker 只做转发。
 *
 * 路径分工：
 *   /            博客首页（Astro 生成，静态 HTML）
 *   /lab/        三维档案终端（Three.js，独立构建产物）
 *   /*           其余静态资源
 *
 * ⚠️ /bobing 与 /ws 不归这个 Worker（2026-10-02 拆分）：
 *    它们属于独立 Worker `bobing-game`（仓库 Woo3aN/bobing）。Cloudflare 按路由
 *    特异性分发，`woo3an.top/bobing*` 比本站的 `woo3an.top/*` 更具体，
 *    这两个路径的请求根本到不了这里。
 *    别在本仓库再实现一份房间服务：两个 Worker 的 Durable Object 存储是分开的，
 *    两边都存 = 同一个房间号出现两份互不相干的房间数据。
 */
export default {
  async fetch(request, env) {
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response("not found", { status: 404 });
  },
};
