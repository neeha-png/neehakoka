import { env } from 'cloudflare:workers';

const DEFAULT_LIMIT = 3;
const WINDOW_SECONDS = 60 * 60; // 1 hour

function getClientIp(request: Request): string {
  // Cloudflare provides this header.
  const ip = request.headers.get('CF-Connecting-IP');
  if (ip && ip.trim().length > 0) return ip.trim();

  // Fallback for non-Cloudflare/local.
  const xff = request.headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }

  return 'unknown';
}

export async function rateLimitByIp(request: Request, route: string, limit = DEFAULT_LIMIT) {
  const portfolioDb = (env as any).portfolio_db;
  if (!portfolioDb) {
    // If DB isn't configured, fail open (avoid breaking the app).
    return { allowed: true };
  }

  const ip = getClientIp(request);

  const nowMs = Date.now();
  const windowStart = Math.floor(nowMs / 1000 / WINDOW_SECONDS) * WINDOW_SECONDS; // seconds

  // Create table if it doesn't exist (idempotent) - safe for local dev.
  // D1 doesn't support multi-statement, so we rely on migration.

  // Use an UPSERT-like pattern via transaction.
  // D1 supports `INSERT ...` then `UPDATE`, but for simplicity we do:
  // - select current
  // - if exists and would exceed limit => deny
  // - else update/insert

  const row = await portfolioDb.prepare(
    `SELECT count FROM api_rate_limits WHERE route = ? AND ip = ? AND window_start = ? LIMIT 1`
  )
    .bind(route, ip, windowStart)
    .first<{ count: number }>();

  const current = row?.count ?? 0;
  if (current >= limit) {
    return {
      allowed: false,
      remaining: 0,
      limit,
      windowResetSeconds: WINDOW_SECONDS - (Math.floor(nowMs / 1000) % WINDOW_SECONDS),
      current,
    };
  }

  if (!row) {
    await portfolioDb.prepare(
      `INSERT INTO api_rate_limits (route, ip, window_start, count) VALUES (?, ?, ?, ?)`
    )
      .bind(route, ip, windowStart, 1)
      .run();
  } else {
    await portfolioDb.prepare(
      `UPDATE api_rate_limits SET count = ? WHERE route = ? AND ip = ? AND window_start = ?`
    )
      .bind(current + 1, route, ip, windowStart)
      .run();
  }

  return {
    allowed: true,
    remaining: Math.max(0, limit - (current + 1)),
    limit,
    windowResetSeconds: WINDOW_SECONDS - (Math.floor(nowMs / 1000) % WINDOW_SECONDS),
    current: current + 1,
  };
}

