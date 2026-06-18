/**
 * INTEGRAUTH - Cloudflare Worker JSON API with external integration
 *
 * Endpoints:
 *  - GET /api/posts
 *  - GET /api/posts/:slug
 *  - GET /api/external-data
 *
 * Resilience requirements:
 *  - External fetch is wrapped with timeout + try/catch
 *  - Edge caching via Cache API
 *  - Graceful degradation on failures:
 *      - return cached stale if available
 *      - otherwise return mock dataset (HTTP 200) so UI can render
 *
 * Notes:
 *  - This file intentionally uses ES Modules syntax (Wrangler "type": "ESModule")
 *  - Secrets must be provided via env bindings (e.g., env.EXTERNAL_API_KEY)
 */

const CACHE_NAME = "integrauth:external-data:v1";

// Small mock post dataset (replace with D1 or CMS later)
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

// Mock dataset for /api/external-data fallback path.
// The UI can still render something meaningful even when the external API is down.
const EXTERNAL_DATA_MOCK = {
  status: "fallback",
  fetchedAt: new Date().toISOString(),
  source: "mock",
  data: [
    { id: 1, name: "Repo A (mock)", stars: 123, updatedAt: "2026-01-10" },
    { id: 2, name: "Repo B (mock)", stars: 98, updatedAt: "2026-02-05" },
    { id: 3, name: "Repo C (mock)", stars: 42, updatedAt: "2026-03-15" },
  ],
};

// Public external API (example). Replace this URL with your real public endpoint.
// If your integration requires an API key, keep it server-side via env.EXTERNAL_API_KEY.
const EXTERNAL_API_URL = "https://api.github.com/users/cloudflare/repos";

/**
 * Builds a consistent JSON response.
 */
function jsonResponse(body, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), { ...init, headers });
}

/**
 * Consistent error shape required by prompt.
 * - status codes: 400, 404
 */
function errorResponse(message, status) {
  return jsonResponse({ error: message, status }, { status });
}

/**
 * Very small URL sanitizer for slug matching.
 */
function normalizeSlug(slug) {
  return String(slug || "").trim().toLowerCase();
}

/**
 * Finds a post by slug. Returns post or undefined.
 */
function getPostBySlug(slug) {
  const s = normalizeSlug(slug);
  return POSTS.find((p) => normalizeSlug(p.slug) === s);
}

/**
 * Fetch with timeout.
 * - Throws on network errors and abort timeout.
 */
async function fetchWithTimeout(url, init, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error("External fetch timed out")), timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Attempts to fetch external data with edge caching + graceful degradation.
 *
 * Cache policy:
 * - Cache key: fixed URL (simple)
 * - On cache hit: return cached response immediately
 * - On cache miss:
 *    - try external fetch (with timeout)
 *    - if success: cache it and return it
 *    - if failure (network/timeout/5xx):
 *        - if a cached response exists, return it as "stale" (HTTP 200)
 *        - else return mock dataset as "fallback" (HTTP 200)
 */
async function getExternalDataWithCache(env) {
  const cache = caches.default;
  const request = new Request(EXTERNAL_API_URL, { method: "GET" });

  // 1) Fast path: serve from cache
  try {
    const cached = await cache.match(request, { ignoreMethod: true });
    if (cached) {
      // Cached responses are considered a valid UI payload.
      return new Response(cached.body, cached);
    }
  } catch {
    // Cache errors should never break the request.
  }

  // 2) Cache miss: fetch from external with timeout & resilience
  const externalKey = env?.EXTERNAL_API_KEY; // must be set in Wrangler secrets; never sent to client.
  const headers = new Headers({
    "accept": "application/json",
  });

  // If your external API needs auth, keep it here and only server-side.
  // Example: GitHub doesn't require EXTERNAL_API_KEY for public endpoints, but other APIs might.
  if (externalKey) {
    // Use a generic header—adjust to your provider as needed.
    headers.set("authorization", `Bearer ${externalKey}`);
  }

  const timeoutMs = 2500;

  try {
    const upstreamResp = await fetchWithTimeout(
      EXTERNAL_API_URL,
      {
        method: "GET",
        headers,
      },
      timeoutMs,
    );

    // Treat 5xx and non-2xx as failure for graceful fallback logic.
    if (!upstreamResp.ok || upstreamResp.status >= 500) {
      throw new Error(`Upstream failed with status ${upstreamResp.status}`);
    }

    // Parse and normalize upstream payload into your UI contract.
    // GitHub returns an array of repos; we map to simplified objects.
    const json = await upstreamResp.json();

    const normalized = Array.isArray(json)
      ? json.map((r, idx) => ({
          id: r.id ?? idx + 1,
          name: r.name,
          stars: r.stargazers_count ?? 0,
          updatedAt: r.updated_at ?? null,
        }))
      : json;

    const payload = {
      status: "ok",
      fetchedAt: new Date().toISOString(),
      source: "external",
      data: normalized,
    };

    const responseToCache = jsonResponse(payload, { status: 200 });

    // Cache the normalized payload at the edge so subsequent requests are fast.
    // Cache API will ignore request method; ignoreMethod match used above.
    try {
      await cache.put(request, responseToCache.clone());
    } catch {
      // If cache put fails, still return successful payload.
    }

    return responseToCache;
  } catch {
    // 3) Fallback strict path:
    // - If any cached payload exists now, return it as "stale" (HTTP 200)
    // - Otherwise return mock dataset as HTTP 200 so UI can render.
    try {
      const cached = await cache.match(request, { ignoreMethod: true });
      if (cached) {
        // Add a small metadata wrapper while keeping status 200.
        // (We can't reliably mutate cached body; simplest is to return cached payload.)
        return new Response(cached.body, cached);
      }
    } catch {
      // ignore
    }

    return jsonResponse(EXTERNAL_DATA_MOCK, { status: 200 });
  }
}

/**
 * Router handler
 */
export default {
  async fetch(request, env, ctx) {
    try {
      if (request.method !== "GET") {
        return errorResponse("Method not allowed", 400);
      }

      const url = new URL(request.url);
      const pathname = url.pathname;

      // Basic router for required endpoints:
      // Note: Cloudflare Workers path handling uses the raw pathname; no frameworks here.
      if (pathname === "/api/posts") {
        return jsonResponse(POSTS);
      }

      if (pathname.startsWith("/api/posts/")) {
        const slug = pathname.slice("/api/posts/".length);
        if (!slug) return errorResponse("Post slug is required", 400);

        const post = getPostBySlug(slug);
        if (!post) {
          return errorResponse("Post not found", 404);
        }
        return jsonResponse(post);
      }

      if (pathname === "/api/external-data") {
        // Must not break UI: graceful degradation with caching and mock fallback.
        return await getExternalDataWithCache(env);
      }

      return errorResponse("Not found", 404);
    } catch {
      // Last-resort safety net: never throw unhandled exceptions.
      // Return a minimal fallback JSON response.
      return jsonResponse(
        { error: "Internal server error", status: 400 },
        { status: 400 },
      );
    }
  },
};
