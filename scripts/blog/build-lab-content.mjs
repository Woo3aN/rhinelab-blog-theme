import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { load as parseYaml } from "js-yaml";
import {
  isPublished,
  labCollectionsSchema,
  pageSchema,
  postSchema,
} from "../../apps/blog/src/content/schema.mjs";

// 生成三维档案入口的公开内容目录。只包含公开文章；同一真实文章可在多个槽位
// 重复映射，但不创建第二份文章、ID 或 canonical。
//
// 输出：.generated/lab-content.json（gitignored，构建时生成）。

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const postsDir = resolve(root, "content/posts");
// 独立页面（关于等）也可以被策展主题引用，从而在 /lab/ 里被打开。
const pagesDir = resolve(root, "content/pages");
const collectionsFile = resolve(root, "content/lab-collections.json");
const outFile = resolve(root, ".generated/lab-content.json");
const SITE = process.env.BLOG_SITE_ORIGIN || "https://example.com";
// 每个策展主题最多占几个槽位。5 个主题一共就是 5 × 这个值条记录。
// 文章数少于槽位时不再循环重复同一篇（空槽位由 fileAtSlot 的钳位吸收），
// 否则 4 篇文章会被摊成几十个档案编号，看着像有几十篇。
const SLOTS_PER_THEME = 3;
// 没有指定文章的列只是补位（空列会让槽位映射崩），每列只补这么多篇，
// 免得几列并排堆满重复内容，档案编号也跟着虚高。
const FALLBACK_SLOTS = 1;

const now = process.env.BUILD_NOW ? new Date(process.env.BUILD_NOW) : new Date();
if (Number.isNaN(now.getTime())) {
  console.error(`BUILD_NOW 不是有效日期：${process.env.BUILD_NOW}`);
  process.exit(1);
}

/** 把数组循环左移 n 位，用于让各列的回退内容错开。 */
const rotate = (items, n) => {
  if (!items.length) return items;
  const offset = ((n % items.length) + items.length) % items.length;
  return [...items.slice(offset), ...items.slice(0, offset)];
};

const errors = [];

// 读取并校验一个目录里的 Markdown（文章与页面字段规范相同，只有 schema 不同）。
async function loadDir(dir, schema, label) {
  if (!existsSync(dir)) return [];
  const found = [];
  for (const name of (await readdir(dir)).filter((n) => n.endsWith(".md")).sort()) {
    const raw = await readFile(resolve(dir, name), "utf8");
    const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw);
    if (!match) {
      errors.push(`${label}/${name}：缺少 frontmatter`);
      continue;
    }
    const parsed = schema.safeParse(parseYaml(match[1]) ?? {});
    if (!parsed.success) {
      errors.push(`${label}/${name}：${parsed.error.issues.map((i) => i.message).join("；")}`);
      continue;
    }
    found.push(parsed.data);
  }
  return found;
}

const posts = await loadDir(postsDir, postSchema, "content/posts");
const pages = await loadDir(pagesDir, pageSchema, "content/pages");

// 页面也进三维档案：这样「关于」这类页面能在 /lab/ 里被打开和阅读。
// 空主题的回退池同样是「全部公开内容」，文章 + 页面。
const published = [...posts, ...pages].filter((entry) => isPublished(entry, now));
const byId = new Map(published.map((entry) => [entry.id, entry]));

let collections;
try {
  collections = labCollectionsSchema.parse(JSON.parse(await readFile(collectionsFile, "utf8")));
} catch (error) {
  errors.push(`content/lab-collections.json：${error.message}`);
}

const records = [];
// 档案编号按「文章 id」的稳定顺序分配：wp-000 → X-001、wp-001 → X-002……
// 这样新增文章只会往后追加，不会因为主题列的顺序或归类调整而整体重排。
// （原先按遍历主题列累加，加一篇文章就会把后面所有编号顶掉。）
const rankById = new Map(
  [...published]
    .sort((a, b) => Number(a.id.replace(/\D/g, "")) - Number(b.id.replace(/\D/g, "")))
    .map((entry, index) => [entry.id, index + 1]),
);
if (collections) {
  collections.themes.forEach((theme, themeIndex) => {
    const assigned = theme.postIds.map((id) => byId.get(id)).filter(Boolean);
    for (const id of theme.postIds) {
      if (!byId.has(id)) errors.push(`主题「${theme.name}」引用了未公开或不存在的文章 ${id}`);
    }
    // 空主题回退到全部公开内容（空列会让槽位映射崩），但按列错开起点，
    // 免得几列并排摆着一模一样的几篇。
    const pool = assigned.length ? assigned : rotate(published, themeIndex);
    // 有指定文章的列全放进去（最多 SLOTS_PER_THEME 篇）；空列只补位，各列错开起点。
    const take = Math.min(assigned.length ? SLOTS_PER_THEME : FALLBACK_SLOTS, pool.length);
    for (let slot = 0; slot < take; slot += 1) {
      const post = pool[slot];
      const displayNumber = rankById.get(post.id);
      records.push({
        id: `X-${String(displayNumber).padStart(3, "0")}`,
        displayNumber,
        postId: post.id,
        title: post.title,
        en: post.title,
        department: theme.name,
        category: theme.name,
        date: post.publishedAt.toISOString().slice(0, 10),
        lead: post.author,
        tags: post.tags ?? [],
        clearance: "PUBLIC",
        abstract: post.description,
        findings: [post.description],
        source: new URL(post.path, SITE).href,
        href: post.path,
      });
    }
  });
}

if (errors.length) {
  console.error(`生成三维内容失败：\n- ${errors.join("\n- ")}`);
  process.exit(1);
}

await mkdir(resolve(root, ".generated"), { recursive: true });
await writeFile(
  outFile,
  `${JSON.stringify(
    {
      generatedAt: now.toISOString(),
      site: SITE,
      columns: collections.themes.map((theme) => theme.name),
      categories: collections.themes.map((theme) => theme.name),
      records,
    },
    null,
    2,
  )}\n`,
  "utf8",
);

console.log(
  `三维内容生成：${records.length} 个槽位（${collections.themes.length} 主题 × ${SLOTS_PER_THEME}），` +
    `引用 ${new Set(records.map((r) => r.postId)).size} 篇公开文章。`,
);
