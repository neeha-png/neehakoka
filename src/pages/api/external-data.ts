// external-data.ts — Resilient external API integration endpoint.
// Fetches public GitHub repos for the Cloudflare org and caches the result at the edge.
// If the external API is slow (>2.5s) or returns an error, falls back to stale cache
// and then to a mock dataset — so the UI never breaks due to an upstream failure.

import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';

// The external API we are integrating with
const EXTERNAL_API_URL = 'https://api.github.com/users/cloudflare/repos';

// Cache key used to store/retrieve the response in Cloudflare's Cache API
const CACHE_NAME = 'integrauth:external-data:v1';

// Static fallback dataset returned when the external API is unavailable and no cache exists.
// Marked with source: 'mock' so the UI can show a degraded-mode indicator if needed.
const EXTERNAL_DATA_MOCK = {
  status: 'fallback',
  fetchedAt: new Date().toISOString(),
  source: 'mock',
  data: [
    { id: 1, name: 'Repo A (mock)', stars: 123, updatedAt: '2026-01-10' },
    { id: 2, name: 'Repo B (mock)', stars: 98, updatedAt: '2026-02-05' },
    { id: 3, name: 'Repo C (mock)', stars: 42, updatedAt: '2026-03-15' },
  ],
};

// Helper that creates a JSON Response with the correct content-type header
function jsonResponse(body: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(body), { ...init, headers });
}

// Wraps fetch with an AbortController timeout.
// Aborts the request if it hasn't resolved within timeoutMs milliseconds.
async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new Error('External fetch timed out')),
    timeoutMs
  );
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    // Always clear the timeout to avoid memory leaks regardless of fetch outcome
    clearTimeout(timeout);
  }
}

// Core data-fetching logic with a three-layer fallback strategy:
//   1. Serve from Cloudflare edge cache (fastest path — no external call)
//   2. Fetch fresh from GitHub API and populate the cache
//   3. Return stale cache or the mock dataset if GitHub is down or times out
async function getExternalDataWithCache() {
  // caches.default is a Cloudflare Workers extension; not in the standard DOM CacheStorage type
  const cache = (caches as any).default as Cache;
  const request = new Request(EXTERNAL_API_URL, { method: 'GET' });

  // Fast path: return the cached response immediately if it exists
  try {
    const cached = await cache.match(request, { ignoreMethod: true });
    if (cached) return new Response(cached.body, cached);
  } catch {
    // Cache read errors should never block the request — fall through to fresh fetch
  }

  // Cache miss — attempt to fetch fresh data from the GitHub API
  const externalKey = (env as any).EXTERNAL_API_KEY;
  const headers = new Headers({ accept: 'application/json' });

  // Attach an auth token if configured — raises the GitHub API rate limit from 60 to 5000/hr
  if (externalKey) headers.set('authorization', `Bearer ${externalKey}`);

  try {
    // 2.5 second timeout prevents slow upstreams from hanging the Worker
    const upstreamResp = await fetchWithTimeout(
      EXTERNAL_API_URL,
      { method: 'GET', headers },
      2500
    );

    // Treat 5xx responses as failures and trigger the fallback path
    if (!upstreamResp.ok || upstreamResp.status >= 500) {
      throw new Error(`Upstream failed with status ${upstreamResp.status}`);
    }

    const json = await upstreamResp.json() as any[];

    // Normalise the GitHub API response shape into a simpler internal format
    const normalized = Array.isArray(json)
      ? json.map((r, idx) => ({
          id: r.id ?? idx + 1,
          name: r.name,
          stars: r.stargazers_count ?? 0,
          updatedAt: r.updated_at ?? null,
        }))
      : json;

    const payload = {
      status: 'ok',
      fetchedAt: new Date().toISOString(),
      source: 'external',
      data: normalized,
    };

    const responseToCache = jsonResponse(payload, { status: 200 });

    // Store the fresh response in the edge cache for subsequent requests
    try {
      await cache.put(request, responseToCache.clone());
    } catch {
      // Cache write failures are non-fatal — still return the live data
    }

    return responseToCache;
  } catch {
    // Fallback layer: try to serve stale cache before resorting to mock data
    try {
      const cached = await cache.match(request, { ignoreMethod: true });
      if (cached) return new Response(cached.body, cached);
    } catch {
      // ignore cache read errors in the fallback path
    }

    // Last resort: return the static mock dataset so the UI always has something to render
    return jsonResponse(EXTERNAL_DATA_MOCK, { status: 200 });
  }
}

// GET /api/external-data — returns cached or live GitHub repo data
export const GET: APIRoute = async () => {
  return await getExternalDataWithCache();
};

// Rejects any non-GET method with a 400 response
export const ALL: APIRoute = async () => {
  return new Response(JSON.stringify({ error: 'Method not allowed', status: 400 }), {
    status: 400,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
};
