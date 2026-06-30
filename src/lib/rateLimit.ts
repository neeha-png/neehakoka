// rateLimit.ts — IP-based rate limiting using the D1 database.
// Called by API routes before processing any request to throttle abusive clients.

import { env } from 'cloudflare:workers';

// Default max requests allowed per IP per window if no limit is passed by the caller
const DEFAULT_LIMIT = 3;

// Rolling window size — one hour in seconds
const WINDOW_SECONDS = 60 * 60;

// Extracts the real client IP address from incoming request headers
function getClientIp(request: Request): string {
  // Cloudflare sets this header to the visitor's true IP on all proxied requests
  const ip = request.headers.get('CF-Connecting-IP');
  if (ip && ip.trim().length > 0) return ip.trim();

  // Fallback for local dev or non-Cloudflare environments — take the first entry
  const xff = request.headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }

  // Last resort: unknown IP — still tracked as a single bucket
  return 'unknown';
}

// Checks whether this IP is allowed to call the given route right now.
// Returns { allowed: true } if under limit, { allowed: false } if over.
// Also returns remaining count and window reset time for informational purposes.
export async function rateLimitByIp(request: Request, route: string, limit = DEFAULT_LIMIT) {
  const portfolioDb = (env as any).portfolio_db;

  // If the D1 database isn't available (e.g. cold local dev), fail open so
  // the app still works rather than blocking every request
  if (!portfolioDb) {
    return { allowed: true };
  }

  const ip = getClientIp(request);

  // Calculate the start of the current 1-hour window as a Unix timestamp (seconds)
  const nowMs = Date.now();
  const windowStart = Math.floor(nowMs / 1000 / WINDOW_SECONDS) * WINDOW_SECONDS;

  // Look up how many times this IP has hit this route in the current window
  const row = (await portfolioDb.prepare(
    `SELECT count FROM api_rate_limits WHERE route = ? AND ip = ? AND window_start = ? LIMIT 1`
  )
    .bind(route, ip, windowStart)
    .first()) as { count: number } | null;

  const current = row?.count ?? 0;

  // If the IP has already hit the limit, reject the request immediately
  if (current >= limit) {
    return {
      allowed: false,
      remaining: 0,
      limit,
      // seconds until the current window expires and the counter resets
      windowResetSeconds: WINDOW_SECONDS - (Math.floor(nowMs / 1000) % WINDOW_SECONDS),
      current,
    };
  }

  // No existing row — create a fresh counter entry for this IP + route + window
  if (!row) {
    await portfolioDb.prepare(
      `INSERT INTO api_rate_limits (route, ip, window_start, count) VALUES (?, ?, ?, ?)`
    )
      .bind(route, ip, windowStart, 1)
      .run();
  } else {
    // Row exists and is under limit — increment the counter by 1
    await portfolioDb.prepare(
      `UPDATE api_rate_limits SET count = ? WHERE route = ? AND ip = ? AND window_start = ?`
    )
      .bind(current + 1, route, ip, windowStart)
      .run();
  }

  // Request is allowed — return remaining quota so callers can include it in headers if needed
  return {
    allowed: true,
    remaining: Math.max(0, limit - (current + 1)),
    limit,
    windowResetSeconds: WINDOW_SECONDS - (Math.floor(nowMs / 1000) % WINDOW_SECONDS),
    current: current + 1,
  };
}
