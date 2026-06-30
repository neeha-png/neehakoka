// posts.ts — GET /api/posts
// Returns a static list of blog post summaries as JSON.
// Posts are defined inline here for zero-latency reads; a future iteration
// could query the Astro content collection or a D1 table at runtime.
import type { APIRoute } from 'astro';

const POSTS = [
  {
    slug: "welcome-to-integrauth",
    title: "Welcome to INTEGRAUTH",
    excerpt: "A production-ready JSON API with resilient external integrations.",
    publishedAt: "2026-01-01",
  },
  {
    slug: "edge-caching-basics",
    title: "Edge Caching Basics",
    excerpt: "How to protect your external API rate limits using Cache API at the edge.",
    publishedAt: "2026-02-01",
  },
  {
    slug: "graceful-degradation",
    title: "Graceful Degradation",
    excerpt: "Never break the UI—return cached stale or a mock dataset when integrations fail.",
    publishedAt: "2026-03-01",
  },
];

export const GET: APIRoute = async () => {
  return new Response(JSON.stringify(POSTS), {
    status: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
};

export const ALL: APIRoute = async () => {
  return new Response(JSON.stringify({ error: 'Method not allowed', status: 400 }), {
    status: 400,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
};