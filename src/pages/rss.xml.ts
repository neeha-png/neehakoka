// rss.xml.ts — RSS 2.0 feed for blog posts.
// Served at /rss.xml; readers like Feedly or NetNewsWire can subscribe to it.
// Uses @astrojs/rss to generate the XML from the blog content collection.
// prerender = true so Cloudflare serves it as a static asset (no Worker invocation per request).

import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';
import type { APIContext } from 'astro';

export const prerender = true;

export async function GET(context: APIContext) {
  // Load all Markdown posts from src/content/blog/
  let posts: any[] = [];
  try {
    posts = await getCollection('blog');
  } catch {
    posts = [];
  }

  // Strip the .md suffix from entry IDs to produce clean URL slugs
  const items = posts.map((post: any) => ({
    title: post.data.title,
    pubDate: post.data.pubDate,
    description: post.data.description,
    // context.site is set by the `site` field in astro.config.mjs
    link: `/blog/${post.id.replace(/\.md$/, '')}`,
  }));

  return rss({
    // Feed metadata shown in RSS readers
    title: "Neeha Koka — Engineering Blog",
    description: "Writing about Astro, Cloudflare Workers, security engineering, and building in public.",
    site: context.site!.toString(),
    items,
    // Standard XML stylesheet for browser-friendly rendering
    stylesheet: false,
    customData: `<language>en-us</language>`,
  });
}
