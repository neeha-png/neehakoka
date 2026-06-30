// external-data.ts — GET /api/external-data
// Fetches the Cloudflare public repo list from GitHub and returns a normalised
// JSON payload. Implements a three-layer resilience strategy so the endpoint
// never returns an error to the browser:
//   Layer 1 — Cloudflare Cache API (edge hit, ~0ms latency)
//   Layer 2 — Live GitHub fetch with 2 500 ms abort timeout
//   Layer 3 — Stale cache entry, then static mock dataset as last resort
// An optional EXTERNAL_API_KEY wrangler secret is forwarded as a Bearer token
// to raise the GitHub API rate limit from 60 → 5 000 req/hr.
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';

const EXTERNAL_API_URL = 'https://api.github.com/users/cloudflare/repos';
// Cache namespace — bump the version suffix to invalidate all edge entries
const CACHE_NAME = 'integrauth:external-data:v1';

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

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(body), { ...init, headers });
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new Error('External fetch timed out')),
    timeoutMs
  );
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function getExternalDataWithCache() {
  const cache = caches.default;
  const request = new Request(EXTERNAL_API_URL, { method: 'GET' });

  // 1) Fast path: serve from cache
  try {
    const cached = await cache.match(request, { ignoreMethod: true });
    if (cached) return new Response(cached.body, cached);
  } catch {
    // Cache errors should never break the request
  }

  // 2) Cache miss: fetch from external
  const externalKey = (env as any).EXTERNAL_API_KEY;
  const headers = new Headers({ accept: 'application/json' });
  if (externalKey) headers.set('authorization', `Bearer ${externalKey}`);

  try {
    const upstreamResp = await fetchWithTimeout(
      EXTERNAL_API_URL,
      { method: 'GET', headers },
      2500
    );

    if (!upstreamResp.ok || upstreamResp.status >= 500) {
      throw new Error(`Upstream failed with status ${upstreamResp.status}`);
    }

    const json = await upstreamResp.json() as any[];

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

    try {
      await cache.put(request, responseToCache.clone());
    } catch {
      // If cache put fails, still return successful payload
    }

    return responseToCache;
  } catch {
    // 3) Fallback: return stale cache or mock
    try {
      const cached = await cache.match(request, { ignoreMethod: true });
      if (cached) return new Response(cached.body, cached);
    } catch {
      // ignore
    }

    return jsonResponse(EXTERNAL_DATA_MOCK, { status: 200 });
  }
}

export const GET: APIRoute = async () => {
  return await getExternalDataWithCache();
};

export const ALL: APIRoute = async () => {
  return new Response(JSON.stringify({ error: 'Method not allowed', status: 400 }), {
    status: 400,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
};