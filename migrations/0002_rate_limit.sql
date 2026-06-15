-- migrations/0002_rate_limit.sql

-- IP-based rate limiting for API endpoints.
-- Stores counts per route per IP per rolling 1-hour window.
CREATE TABLE IF NOT EXISTS api_rate_limits (
  route TEXT NOT NULL,
  ip TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (route, ip, window_start)
);

