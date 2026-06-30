-- 0002_rate_limit.sql — Adds the IP-based rate limiting table.
-- Used by src/lib/rateLimit.ts to track request counts per route per IP per hour.
-- The composite primary key (route, ip, window_start) ensures one row per bucket.

-- Tracks how many times a given IP has hit a given route within a 1-hour window.
-- window_start is a Unix timestamp (seconds) aligned to the start of the current hour.
-- count is incremented on each allowed request and checked before processing.
CREATE TABLE IF NOT EXISTS api_rate_limits (
  route        TEXT    NOT NULL,           -- API route name, e.g. 'chat', 'contact', 'submit'
  ip           TEXT    NOT NULL,           -- Client IP from CF-Connecting-IP header
  window_start INTEGER NOT NULL,           -- Start of the current 1-hour window (Unix seconds)
  count        INTEGER NOT NULL DEFAULT 0, -- Number of requests made in this window
  PRIMARY KEY (route, ip, window_start)    -- One row per route + IP + window combination
);
