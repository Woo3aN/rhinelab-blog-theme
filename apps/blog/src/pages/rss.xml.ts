import rss from "@astrojs/rss";
import type { APIRoute } from "astro";
import { getPublishedPosts } from "../lib/content";

export const GET: APIRoute = async (context) => {
  const posts = await getPublishedPosts();
  const site = context.site ?? new URL("https://example.com");
  return rss({
    title: "Woo3aN's Blog",
    description: "用 Markdown 写作、Git 发布的个人博客。",
    site,
    items: posts.map((post) => ({
      title: post.data.title,
      description: post.data.description,
      pubDate: post.data.publishedAt,
      link: post.data.path,
      categories: [...post.data.categories, ...post.data.tags],
      author: post.data.author,
    })),
    customData: "<language>zh-cn</language>",
  });
};
