// [slug].ts — Public JSON API for fetching a single blog post by slug.
// GET /api/posts/:slug → 200 with post object, 400 if slug missing, 404 if not found.
// All other HTTP methods → 400 Method Not Allowed.

import type { APIRoute } from 'astro';

// Static post data — mirrors the list in posts.ts.
// Both files share the same data source so slug lookups stay consistent.
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

// Normalises a slug to lowercase and trims whitespace for case-insensitive matching
function normalizeSlug(slug: string) {
  return String(slug || '').trim().toLowerCase();
}

export const GET: APIRoute = async ({ params }) => {
  const slug = params.slug;

  // Return 400 if the slug segment is missing entirely (shouldn't happen with Astro routing,
  // but guards against unexpected proxy or direct-call scenarios)
  if (!slug) {
    return new Response(JSON.stringify({ error: 'Post slug is required', status: 400 }), {
      status: 400,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }

  // Find the post whose slug matches the requested slug (case-insensitive)
  const post = POSTS.find((p) => normalizeSlug(p.slug) === normalizeSlug(slug));

  // Return 404 if no post matches the given slug
  if (!post) {
    return new Response(JSON.stringify({ error: 'Post not found', status: 404 }), {
      status: 404,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }

  // Return the matched post as JSON
  return new Response(JSON.stringify(post), {
    status: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
};

// Rejects any non-GET method with a 400 response
export const ALL: APIRoute = async () => {
  return new Response(JSON.stringify({ error: 'Method not allowed', status: 400 }), {
    status: 400,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
};
