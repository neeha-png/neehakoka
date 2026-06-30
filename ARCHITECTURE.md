# Architecture & Code Tour

## Stack at a Glance

| Layer | Technology |
|---|---|
| Framework | Astro 6 (`output: "server"`) |
| Runtime | Cloudflare Workers (V8 isolates) |
| Adapter | `@astrojs/cloudflare` |
| Middleware | `src/middleware.ts` — CSP nonce + security headers on every response |
| Database | Cloudflare D1 (SQLite, binding: `portfolio_db`) |
| Session store | Cloudflare KV (binding: `SESSION`) |
| Edge cache | Cloudflare Cache API |
| Edge rate limiting | Cloudflare Workers Rate Limiting API (2 bindings in `wrangler.jsonc`) |
| Bot protection | Cloudflare Turnstile (widget + server-side `siteverify`) |
| Email | Resend transactional API |
| AI | Cloudflare Workers AI (`@cf/meta/llama-3.1-8b-instruct`, binding: `AI`) |
| Deploy | Wrangler + GitHub Actions |

---

## Directory Structure

```
personal-portfolio/
├── src/
│   ├── middleware.ts             # Astro middleware: CSP nonce gen + all security headers
│   ├── env.d.ts                  # TypeScript: App.Locals.nonce declaration
│   ├── layouts/
│   │   └── Layout.astro          # HTML shell: meta, OG tags, skip-link, theme script, nonce on inline scripts
│   ├── components/
│   │   └── ChatWidget.astro      # Floating AI chat button + panel
│   ├── data/
│   │   └── cv.ts                 # Hardcoded CV text; grounds the Workers AI system prompt
│   ├── lib/
│   │   ├── rateLimit.ts          # IP-based D1 rate limiter (route + IP + hour window)
│   │   └── profileContext.ts     # (helper) profile metadata for future use
│   ├── pages/
│   │   ├── index.astro           # Single-page portfolio (hero, about, projects, blog, contact)
│   │   ├── about.astro           # Dedicated about/resume page
│   │   ├── projects.astro        # Project case studies with accordion expand/collapse
│   │   ├── blogs.astro           # Blog listing from content collection
│   │   ├── contact.astro         # Standalone contact page with Turnstile widget
│   │   ├── admin.astro           # Protected admin panel (session-gated)
│   │   ├── 404.astro             # Custom 404 page
│   │   ├── rss.xml.ts            # RSS 2.0 feed (prerendered)
│   │   ├── blog/
│   │   │   └── [...slug].astro   # Dynamic blog post renderer
│   │   └── api/
│   │       ├── chat.ts           # POST — Workers AI chatbot (input guardrail + output filter)
│   │       ├── contact.ts        # POST — contact form (Turnstile + sanitize + D1 + Resend)
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

### `src/middleware.ts`
Runs on every request via Astro's middleware layer (`defineMiddleware`). Responsibilities:
- Generates a 128-bit random nonce per request via `crypto.getRandomValues`
- Stores the nonce in `context.locals.nonce` so pages can apply it to `<script is:inline>` tags
- Injects all HTTP security headers onto the outgoing response:
  - `Content-Security-Policy` — strict `script-src 'self' 'nonce-{n}' https://challenges.cloudflare.com`; `object-src 'none'`; `frame-src https://challenges.cloudflare.com`
  - `X-Frame-Options: DENY`
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Permissions-Policy: camera=(), microphone=(), geolocation=()`

### `src/env.d.ts`
TypeScript ambient declaration that extends `App.Locals` to include `nonce: string`. Without this, `Astro.locals.nonce` is typed as `unknown` and TypeScript rejects every usage site.

### `src/layouts/Layout.astro`
The single HTML shell used by every page. Responsibilities:
- Sets `<title>`, `<meta description>`, canonical URL
- Injects Open Graph + Twitter Card tags for social sharing
- Renders a skip-to-content `<a>` link for keyboard accessibility (WCAG 2.1 AA)
- Reads `Astro.locals.nonce` and applies it to the theme-bootstrap `<script is:inline nonce={nonce}>` — without this the CSP blocks the inline script and dark mode breaks on first visit
- Defines CSS custom properties for the colour palette and declares the media-query dark-mode fallback
- All nav/social link hover effects use CSS class rules (`.nav-link`, `.social-icon`, brand variants) instead of `onmouseover`/`onmouseout` attributes, which are blocked by CSP `script-src` without `unsafe-inline`

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
1. Workers Rate Limiting (`CHAT_RATE_LIMITER`) — 8 req/60 s per IP at the edge
2. D1 rate limit check — 6 per IP per hour (backup layer)
3. Validates `message` is non-empty string
4. **Input guardrail** (`isPromptInjection`) — 16 regex patterns covering DAN, "ignore previous instructions", persona swaps, `[[SYSTEM]]` delimiter injection, debug-mode tricks, prompt-extraction questions. If triggered: returns 400, model is never called.
5. Prepends CV context from `src/data/cv.ts` as a system prompt
6. Calls Workers AI (`@cf/meta/llama-3.1-8b-instruct`) via `env.AI.run()` with `stream: true`, `max_tokens: 220`
7. **`bufferSseStream`** — reads the full `ReadableStream` SSE response into a string before sending to client
8. **Output filter** (`filterOutput`) — 7 patterns checking for system-prompt leakage, salary figures, secret key names, off-topic affirmations. Replaces violations with a safe fallback.
9. **`makeSseResponse`** — wraps filtered text back into a valid SSE stream so the client's `getReader()` loop works unchanged

### `src/pages/api/contact.ts`
```
POST /api/contact
Body: { name: string, email: string, message: string, 'cf-turnstile-response': string }
```
1. Workers Rate Limiting (`CONTACT_RATE_LIMITER`) — 3 req/60 s per IP at the edge
2. D1 rate limit — 3 per IP per hour (backup layer)
3. **Turnstile bot check** (`verifyTurnstile`) — POSTs token to `https://challenges.cloudflare.com/turnstile/v0/siteverify` with `TURNSTILE_SECRET_KEY`; rejects with 403 if `success: false`
4. **Max-length enforcement** — name ≤ 100, email ≤ 254 (RFC 5321), message ≤ 2000 chars
5. **XSS payload detection** (`hasDangerousPayload`) — rejects `<script`, `javascript:`, `on\w+=`, `<iframe`, `<object`, `<embed`, `<svg`, `data:text/html`
6. **HTML stripping** (`stripHtml`) + format validation — removes residual tags, validates name ≥ 2 chars and email regex
7. **Saves sanitised values to D1 first** (`safeName`, `safeEmail`, `safeMessage`) — so no message is lost even if email fails
8. Calls Resend API with HTML-escaped values in the email template (`escape()` helper)
9. Returns 200 on full success, 502 if Resend fails but D1 save succeeded

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
   { name, email, message, 'cf-turnstile-response': '<token>' }

2. Cloudflare Edge — Workers Rate Limiter
   → CONTACT_RATE_LIMITER.limit({ key: clientIp })
   → count < 3 within 60 s window → allowed
   (flood traffic is dropped here before any Worker CPU is allocated)

3. Astro Middleware (src/middleware.ts)
   → Generates 128-bit random nonce
   → Attaches CSP + X-Frame-Options + nosniff + Referrer-Policy headers

4. Astro Worker (contact.ts) — D1 Rate Limiter
   → Reads CF-Connecting-IP header
   → Calls rateLimitByIp("contact", ip, 3) → D1 rolling-hour check
   → count < 3 → allowed

5. Turnstile Bot Check
   → POST https://challenges.cloudflare.com/turnstile/v0/siteverify
   → { secret: TURNSTILE_SECRET_KEY, response: token, remoteip: clientIp }
   → success: true → passes

6. Sanitization
   → name.length ≤ 100 ✓  email.length ≤ 254 ✓  message.length ≤ 2000 ✓
   → hasDangerousPayload(name|email|message) → false ✓
   → safeName = stripHtml(name), safeEmail = stripHtml(email), safeMessage = stripHtml(message)
   → safeName.length >= 2 ✓
   → safeEmail matches /^[^\s@]+@[^\s@]+\.[^\s@]+$/ ✓
   → safeMessage.length >= 10 ✓

7. D1 Write (sanitised values)
   → INSERT INTO submissions (id, name, email, message, status, created_at)
      VALUES (uuid(), ?, ?, ?, 'pending', datetime('now'))
      .bind(uuid, safeName, safeEmail, safeMessage, ...)
   → Succeeds → submission persisted

8. Resend API (HTML-escaped values)
   → POST https://api.resend.com/emails
   → html: `<p><strong>Name:</strong> ${escape(safeName)}</p> ...`
   → 200 OK → email delivered

9. Response
   → 200 { message: "Message sent successfully!" }

10. Browser (contact.astro script)
    → Shows green success banner
    → Calls form.reset() + turnstile.reset()
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
| `RESEND_API_KEY` | Cloudflare Workers secret | Resend transactional email |
| `ADMIN_PASSWORD` | Cloudflare Workers secret | Admin panel login password |
| `TURNSTILE_SECRET_KEY` | Cloudflare Workers secret | Server-side Turnstile token verification (`wrangler secret put TURNSTILE_SECRET_KEY`) |
| `TO_EMAIL` | `wrangler.jsonc` vars | Inbox for contact form notifications |
| `ADMIN_USERNAME` | `wrangler.jsonc` vars | Admin panel username (non-secret) |

Secrets are set via `wrangler secret put <NAME>` and are never stored in `.dev.vars` or committed to git.

The Turnstile **Site Key** (public) is embedded directly in `src/pages/contact.astro` as `data-sitekey`. Only the **Secret Key** goes into Workers secrets.
