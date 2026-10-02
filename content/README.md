# 内容目录

本目录是博客的正文唯一来源。所有公开页面、摘要、RSS、sitemap、搜索索引和三维卡片都由这里派生。

## 目录结构

| 路径 | 用途 |
| --- | --- |
| `posts/*.md` | 博客文章，一篇一个文件 |
| `pages/*.md` | 独立页面（关于、友链等） |
| `lab-collections.json` | 三维档案的五个策展主题，引用稳定文章 ID |

仓库内现有内容都是**示例内容**：可以整体替换成你自己的文章，只需保留字段规则。

## 文章 frontmatter

```yaml
---
id: post-hello
title: 从 WordPress 到 Markdown
description: 用于首页、搜索、分享和三维卡片的摘要。
path: /2026/09/09/hello-rhinelab/
publishedAt: "2026-09-09T10:00:00+08:00"
updatedAt: "2026-09-09T10:00:00+08:00"
draft: false
categories: [技术]
tags: [Astro, Markdown]
findings:
  - 同一份源数据派生多个入口，就没有两处维护的问题。
  - 摘要决定列表、搜索与分享的观感，不能交给机器糊弄。
author: Woo3aN
cover: /blog/cover-sample.svg
legacyUrls:
  - /?p=101
---
```

| 字段 | 规则 |
| --- | --- |
| `id` | 稳定身份。发布后不因标题或排序变化重建；建议用 `post-<稳定短标识>` |
| `title` | 非空 |
| `description` | 非空，最多 300 字，用于列表、搜索与分享 |
| `path` | 唯一规范站内路径；不得与 `/lab/`、`/tags/`、`/categories/`、`/search/`、`/archive/`、RSS 等系统路由冲突 |
| `publishedAt` / `updatedAt` | 带时区的 ISO 8601；晚于构建时间或 `draft: true` 的内容不进入任何公开产物 |
| `categories` / `tags` | 字符串数组 |
| `findings` | 可选。三维档案「研究记录」标签页的条目，最多 6 条；不写就退化成用 `description` 顶一条（两个标签内容会重复）。写法见下 |
| `cover` | 可选，站内路径时必须是 `apps/blog/public` 下真实存在的文件 |
| `legacyUrls` | 旧地址，用于生成一对一永久重定向 |

> 含 `: ` 的字段值请加引号（例如 description 里出现 `draft: true` 时），否则 YAML 解析会失败。

## 研究记录怎么写

三维档案的「概述」标签放 `description`，「研究记录」标签放 `findings`。两者分工不同：
**摘要说这篇写了什么，研究记录写从这篇里能抽出哪些可复用的判断**。所以不要把摘要抄一遍。

按下面这个风格写（参考上游 RhineLabUI 的档案条目）：

- **一条一句，20–28 字**；界面会自动编号，不用自己写序号。
- **不出现人名、书名和具体事件**，只留抽象出来的观察。
- **不做评价**（没有"精彩""深刻"这类词），多用记录、比较、分开、保留、核对这类动词。
- 常见句式：「A 与 B 需要分开判断」「为…保留…，不能只…」「记录 A、B 与 C 之间的联系」。

本站现有内容的示例：

```yaml
findings:
  - 文章的风格与内核需要分开判断，冷峻未必等于冷漠。
  - 时代先决定了写什么，作者真正解决的是怎么写。
  - 把立场的转变按时间排列，比按作品分类更容易看清脉络。
```

## 主题配置

`lab-collections.json` 固定五个主题，每个主题最多八个槽位，`postIds` 只能引用已公开文章的 `id`。
非空主题不足八篇时可重复映射同一篇文章；空主题当前回退显示全部公开文章，不会生成假文章。
校验会拒绝悬空引用、重复引用和未公开引用。

## 修改与验证

1. 编辑或新增 Markdown。
2. 运行 `npm run check:content` 校验字段、ID/路径唯一性、保留路由、封面存在性和主题引用。
3. 运行 `npm run build` 生成博客、三维入口和搜索索引。
4. 运行 `npm run preview` 在本地检查阅读、导航、搜索与 404。
