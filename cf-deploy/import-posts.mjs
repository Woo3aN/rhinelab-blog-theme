// 导入写作端（Obsidian 的 Blog/_posts）的新文章到本站 content/posts。
//
// 用法：node cf-deploy/import-posts.mjs
//   POSTS_SRC=<目录>  覆盖写作端目录（默认 Obsidian 的 Blog/_posts）
//
// 行为：
//   · 按标题去重，只导入还没导入过的文章（已导入的不会动）
//   · id 自动分配：取现有最大的 wp-<数字> 往后顺延
//   · path 沿用写作端的 /年/月/日/标题/ 结构
//   · 摘要先自动从正文首段提取，并在 frontmatter 里打上「摘要待润色」标记，
//     由人工（或 AI）改成真正想要的那句话后再上线
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { resolve, basename } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(new URL("../", import.meta.url));
const { load: parseYaml } = require("js-yaml");

const ROOT = resolve(new URL("../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
// 写作端目录不写死（公开仓库不该带本机路径）：由 POSTS_SRC 传入。
const SRC = process.env.POSTS_SRC || "";
const POSTS_DIR = resolve(ROOT, "content/posts");
const PAGES_DIR = resolve(ROOT, "content/pages");
const SKIP = new Set(["hello-world.md"]);

const frontmatter = (raw) => {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
  return match ? { yaml: match[1], body: raw.slice(match[0].length) } : null;
};

/** 从正文里挑一句能当摘要的话：跳过引用块与纯强调行，取第一段。 */
function draftDescription(body) {
  const lines = body.split(/\r?\n/);
  const paragraph = [];
  for (const line of lines) {
    const text = line.trim();
    if (!text) {
      if (paragraph.length) break;
      continue;
    }
    if (text.startsWith(">") || text.startsWith("#") || text.startsWith("---")) {
      if (paragraph.length) break;
      continue;
    }
    paragraph.push(text);
    if (text.endsWith("。") && paragraph.join("").length >= 40) break;
  }
  let text = paragraph.join("").replace(/\*+/g, "").replace(/`/g, "").replace(/\s+/g, " ").trim();
  if (text.length > 140) {
    const cut = text.slice(0, 140);
    const stop = Math.max(cut.lastIndexOf("。"), cut.lastIndexOf("，"), cut.lastIndexOf(" "));
    text = (stop > 60 ? cut.slice(0, stop) : cut) + "…";
  }
  return text || "（待补摘要）";
}

const iso = (date) => {
  const text = String(date).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(text);
  if (!m) throw new Error(`无法解析日期：${text}`);
  const [, y, mo, d, h = "12", mi = "00"] = m;
  return `${y}-${mo}-${d}T${h}:${mi}:00+08:00`;
};

// 现有文章：标题 -> 已导入，顺便取 id 最大值。
const known = new Set();
let maxId = 0;
for (const dir of [POSTS_DIR, PAGES_DIR]) {
  if (!existsSync(dir)) continue;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".md")) continue;
    const raw = readFileSync(resolve(dir, name), "utf8");
    const fm = frontmatter(raw);
    if (!fm) continue;
    const data = parseYaml(fm.yaml) || {};
    if (data.title) known.add(String(data.title).trim());
    const m = /^wp-(\d+)$/.exec(String(data.id || ""));
    if (m) maxId = Math.max(maxId, Number(m[1]));
  }
}

if (!SRC) {
  console.error("用 POSTS_SRC=<写作端目录> 指定要导入的目录，例如：\n  POSTS_SRC=~/Blog/_posts npm run import:posts");
  process.exit(1);
}
if (!existsSync(SRC)) {
  console.error(`写作端目录不存在：${SRC}\n用 POSTS_SRC=<目录> 指定。`);
  process.exit(1);
}
mkdirSync(POSTS_DIR, { recursive: true });

const imported = [];
const skipped = [];
for (const name of readdirSync(SRC).filter((n) => n.endsWith(".md")).sort()) {
  if (SKIP.has(basename(name))) continue;
  const raw = readFileSync(resolve(SRC, name), "utf8");
  const fm = frontmatter(raw);
  if (!fm) {
    console.log(`跳过（无 frontmatter）：${name}`);
    continue;
  }
  const old = parseYaml(fm.yaml) || {};
  const title = String(old.title ?? basename(name, ".md")).trim();
  if (known.has(title)) {
    skipped.push(title);
    continue;
  }
  // 页面（带 permalink 且不是日期型文章）不在这里处理，交给手工。
  if (old.permalink && !old.date) {
    console.log(`跳过（疑似页面）：${name}`);
    continue;
  }
  maxId += 1;
  const id = `wp-${String(maxId).padStart(3, "0")}`;
  const publishedAt = iso(old.date ?? "1970-01-01");
  const path = `/${publishedAt.slice(0, 10).replace(/-/g, "/")}/${title}/`;
  const q = (v) => JSON.stringify(v);
  const list = (v) => (v?.length ? `[${v.map(q).join(", ")}]` : "[]");
  const body = fm.body.replace(/^\s*\n/, "");
  const lines = [
    "---",
    `id: ${id}`,
    `title: ${q(title)}`,
    // 摘要待润色：脚本只能从正文首段草拟，真正上线前请改成自己（或 AI）写的那句话。
    `description: ${q(draftDescription(body))} # 摘要待润色`,
    `path: ${q(path)}`,
    `publishedAt: ${q(publishedAt)}`,
    "draft: false",
    `categories: ${list(old.categories ?? [])}`,
    `tags: ${list(old.tags ?? [])}`,
    'author: "Woo3aN"',
    "---",
    "",
  ];
  writeFileSync(resolve(POSTS_DIR, `${id}.md`), `${lines.join("\n")}${body}`, "utf8");
  imported.push({ id, title, path });
}

if (imported.length) {
  console.log(`导入 ${imported.length} 篇新文章：`);
  for (const item of imported) console.log(`  ${item.id}  ${item.title}  ${item.path}`);
  console.log(
    "\n⚠️ 摘要是从正文首段自动草拟的，标记了「摘要待润色」。\n" +
      "   上线前请把每篇的 description 改成真正想要的那句话，再跑 bash cf-deploy/publish.sh。",
  );
} else {
  console.log(`没有新文章（已导入 ${known.size} 篇，写作端目录：${SRC}）`);
}
if (skipped.length) console.log(`已存在，未重复导入：${skipped.join("、")}`);
