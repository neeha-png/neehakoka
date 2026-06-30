// posts.ts — Public JSON API returning the list of all blog posts.
// GET /api/posts → 200 JSON array of post stubs
// All other HTTP methods → 400 Method Not Allowed

import type { APIRoute } from 'astro';

// Static post data — each entry represents a published blog post stub.
// In a larger project this would be fetched from D1 or a CMS.
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

// Returns the full list of posts as a JSON array with a 200 status
export const GET: APIRoute = async () => {
  return new Response(JSON.stringify(POSTS), {
    status: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
};

// Catches any non-GET methods (POST, PUT, DELETE, etc.) and returns 400
export const ALL: APIRoute = async () => {
  return new Response(JSON.stringify({ error: 'Method not allowed', status: 400 }), {
    status: 400,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
};
