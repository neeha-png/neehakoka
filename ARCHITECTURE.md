# Architecture & Code Tour

## Stack at a Glance

| Layer | Technology |
|---|---|
| Framework | Astro 6 (`output: "server"`) |
| Runtime | Cloudflare Workers (V8 isolates) |
| Adapter | `@astrojs/cloudflare` |
| Database | Cloudflare D1 (SQLite, binding: `portfolio_db`) |
| Session store | Cloudflare KV (binding: `SESSION`) |
| Edge cache | Cloudflare Cache API |
| Email | Resend transactional API |
| AI | Google Gemini 2.5 Flash Lite |
| Deploy | Wrangler + GitHub Actions |

---

## Directory Structure

```
personal-portfolio/
├── src/
│   ├── layouts/
│   │   └── Layout.astro          # HTML shell: meta, OG tags, skip-link, theme script
│   ├── components/
│   │   └── ChatWidget.astro      # Floating AI chat button + panel
│   ├── data/
│   │   └── cv.ts                 # Hardcoded CV text; grounds the Gemini system prompt
│   ├── lib/
│   │   ├── rateLimit.ts          # IP-based D1 rate limiter (route + IP + hour window)
│   │   └── profileContext.ts     # (helper) profile metadata for future use
│   ├── pages/
│   │   ├── index.astro           # Single-page portfolio (hero, about, projects, blog, contact)
│   │   ├── about.astro           # Dedicated about/resume page
│   │   ├── projects.astro        # Project case studies with accordion expand/collapse
│   │   ├── blogs.astro           # Blog listing from content collection
│   │   ├── contact.astro         # Standalone contact page
│   │   ├── admin.astro           # Protected admin panel (session-gated)
│   │   ├── 404.astro             # Custom 404 page
│   │   ├── rss.xml.ts            # RSS 2.0 feed (prerendered)
│   │   ├── blog/
│   │   │   └── [...slug].astro   # Dynamic blog post renderer
│   │   └── api/
│   │       ├── chat.ts           # POST — Gemini AI chatbot proxy
│   │       ├── contact.ts        # POST — contact form (D1 + Resend)
│   │       ├── external-data.ts  # GET  — GitHub stats with cache/fallback
│   │       ├── login.js          # POST — admin login, issues session cookie
│   │       ├── logout.ts         # POST — admin logout, invalidates session
│   │       ├── posts.ts          # GET  — static blog post list
│   │       ├── submit.js         # POST — legacy contact (D1 only, no email)
│   │       └── posts/
│   │           └── [slug].ts     # GET  — single post lookup by slug
│   └── content/
│       └── blog/
│           ├── first-post.md
│           └── learning-security.md
├── migrations/
│   ├── 0001_init.sql             # submissions table (UUID PK, name, email, message, status)
│   ├── 0002_rate_limit.sql       # rate_limits table (route+IP+window composite PK)
│   └── 0003_fix_submissions.sql  # Re-creates submissions with TEXT id for UUID compatibility
├── .github/
│   └── workflows/
│       ├── ci.yml                # Lint + type-check on pull requests
│       └── deploy.yml            # Wrangler deploy on push to main
├── openapi.yaml                  # OpenAPI 3.1 spec for all /api/* routes
├── HLD.md                        # High-level component diagram
├── ARCHITECTURE.md               # This file — code tour and request lifecycle
├── DECISIONS.md                  # Architecture decisions and trade-offs
├── TESTING.md                    # Manual test log (browsers, viewports, accessibility)
├── EVALS.md                      # AI chatbot eval suite (20 deterministic test cases)
├── astro.config.mjs              # Astro config (site URL, cloudflare adapter)
└── wrangler.jsonc                # Cloudflare bindings (D1, KV, ASSETS, vars)
```

---

## Key Files Deep Dive

### `src/layouts/Layout.astro`
The single HTML shell used by every page. Responsibilities:
- Sets `<title>`, `<meta description>`, canonical URL
- Injects Open Graph + Twitter Card tags for social sharing
- Renders a skip-to-content `<a>` link for keyboard accessibility (WCAG 2.1 AA)
- Runs an inline `<script>` before paint to apply the saved theme (dark/light) without flash
- Defines CSS custom properties for the colour palette and declares the media-query dark-mode fallback

### `src/lib/rateLimit.ts`
Called at the top of every write API route before any business logic.
```
checkRateLimit(route, ip, db, limit, windowSeconds)
  → { allowed: boolean, remaining: number }
```
- Reads `CF-Connecting-IP` header (set by Cloudflare; not spoofable)
- Computes `window_start = Math.floor(Date.now() / 1000 / windowSeconds) * windowSeconds` (rolling bucket)
- Upserts a row in `rate_limits(route, ip, window_start, count)` using `INSERT OR IGNORE` + `UPDATE`
- Returns `allowed: false` when count exceeds limit; fails open if D1 is unavailable

### `src/pages/api/chat.ts`
```
POST /api/chat
Body: { message: string, history?: Array<{role, content}> }
```
1. Rate limit check: 6 per IP per hour
2. Validates `message` is non-empty string
3. Prepends CV context from `src/data/cv.ts` as a system prompt
4. Maps `history` to Gemini's `contents` array (translating `"assistant"` → `"model"`)
5. Calls Gemini 2.5 Flash Lite (`gemini-2.5-flash-lite-preview-06-17`) with `temperature: 0.4`, `maxOutputTokens: 220`
6. Extracts `candidates[0].content.parts[0].text` and returns `{ reply }`

### `src/pages/api/contact.ts`
```
POST /api/contact
Body: { name: string, email: string, message: string }
```
1. Rate limit: 3 per IP per hour
2. Validates name (≥2 chars), email (regex), message (≥10 chars, ≤2000 chars)
3. **Saves to D1 first** — so no message is lost even if the email step fails
4. Calls Resend API with `from: portfolio@resend.dev`, `to: TO_EMAIL` env var
5. Returns 200 on full success, 502 if Resend fails but D1 save succeeded

### `src/pages/api/external-data.ts`
Three-layer resilience:
1. **Cache API** — `caches.default.match(cacheKey)` returns cached response if hit (TTL 10 min)
2. **Live fetch** — `fetchWithTimeout(url, token, 5000)` calls `api.github.com/users/neeha-png`
3. **Mock fallback** — static object returned if both upstream layers fail

### `src/components/ChatWidget.astro`
Floating action button (FAB) in the bottom-right corner. Renders a chat panel with:
- A scrollable message area (role-based left/right alignment)
- A growing `<textarea>` that auto-resizes with content
- Conversation history capped at 16 messages (8 turns) to keep token costs bounded
- `aria-expanded` toggled on the FAB button for screen reader state announcements

---

## End-to-End Request Lifecycle

### Example: User submits contact form

```
1. Browser
   POST /api/contact
   Content-Type: application/json
   { name, email, message }

2. Cloudflare Edge
   → Routes to Worker (not ASSETS) because path matches /api/*

3. Astro Worker (contact.ts)
   → Reads CF-Connecting-IP header
   → Calls checkRateLimit("contact", ip, env.portfolio_db, 3, 3600)
   → D1 query: SELECT count FROM rate_limits WHERE route=? AND ip=? AND window_start=?
   → count < 3 → allowed

4. Validation
   → name.length >= 2 ✓
   → email matches /^[^\s@]+@[^\s@]+\.[^\s@]+$/ ✓
   → message.length in [10, 2000] ✓

5. D1 Write
   → INSERT INTO submissions (id, name, email, message, status, created_at)
      VALUES (uuid(), ?, ?, ?, 'pending', datetime('now'))
   → Succeeds → submission persisted

6. Resend API
   → POST https://api.resend.com/emails
   → { from, to: env.TO_EMAIL, subject, html }
   → 200 OK → email delivered

7. Response
   → 200 { message: "Message received! I will get back to you soon." }

8. Browser (contact.astro script)
   → Shows green success banner
   → Calls form.reset()
   → Re-enables submit button
```

---

## Database Schema

```sql
-- Contact form submissions
CREATE TABLE submissions (
  id          TEXT PRIMARY KEY,     -- UUID string
  name        TEXT NOT NULL,
  email       TEXT NOT NULL,
  message     TEXT NOT NULL,
  status      TEXT DEFAULT 'pending', -- pending | read | archived
  created_at  DATETIME DEFAULT (datetime('now'))
);

-- IP-based rate limiting buckets
CREATE TABLE rate_limits (
  route        TEXT NOT NULL,   -- e.g. "contact", "chat"
  ip           TEXT NOT NULL,
  window_start INTEGER NOT NULL, -- Unix seconds (start of rolling hour)
  count        INTEGER DEFAULT 1,
  PRIMARY KEY (route, ip, window_start)
);
```

---

## CI/CD Pipeline

```
Pull Request opened
  └─► ci.yml
        ├── npm ci
        ├── astro check (TypeScript types)
        └── (lint if configured)

Push to main
  └─► deploy.yml
        ├── npm ci
        ├── astro build → dist/
        └── wrangler deploy (reads CLOUDFLARE_API_TOKEN secret)
```

Secrets managed via GitHub repository secrets → never in source code.

---

## Environment Variables

| Variable | Where set | Purpose |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | GitHub Actions secret | Wrangler authentication for CI deploy |
| `GEMINI_API_KEY` | Cloudflare Workers secret | Gemini API key for AI chatbot |
| `RESEND_API_KEY` | Cloudflare Workers secret | Resend transactional email |
| `ADMIN_PASSWORD` | Cloudflare Workers secret | Admin panel login password |
| `TO_EMAIL` | `wrangler.jsonc` vars | Inbox for contact form notifications |
| `ADMIN_USERNAME` | `wrangler.jsonc` vars | Admin panel username (non-secret) |

Secrets are set via `wrangler secret put <NAME>` and are never stored in `.dev.vars` or committed to git.
