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
│   │   ├── profileContext.ts     # (helper) profile metadata for future use
│   │   ├── messageCounter.ts     # Pure fn: contact-form char counter state (TDD, Extension 5)
│   │   └── messageCounter.test.ts # Vitest unit tests for messageCounter.ts
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
├── e2e/
│   ├── contact-form.spec.ts      # Playwright: char counter, fill/submit/success state
│   └── dark-mode.spec.ts         # Playwright: theme toggle persists across reload
├── .github/
│   └── workflows/
│       ├── ci.yml                # Unit (Vitest) + E2E (Playwright) tests on pull requests
│       └── deploy.yml            # Wrangler deploy on push to main
├── openapi.yaml                  # OpenAPI 3.1 spec for all /api/* routes
├── HLD.md                        # High-level component diagram
├── ARCHITECTURE.md               # This file — code tour and request lifecycle
├── DECISIONS.md                  # Architecture decisions and trade-offs
├── TESTING.md                    # Manual test log + automated suite coverage/run instructions
├── EVALS.md                      # AI chatbot eval suite (20 deterministic test cases)
├── astro.config.mjs              # Astro config (site URL, cloudflare adapter)
├── playwright.config.ts          # E2E config — targets real `wrangler dev` on :8787
├── vitest.config.ts              # Unit test config — scans src/**/*.test.ts
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
2. Validates name (≥2 chars), email (regex), message (≥10 chars)
3. **Saves to D1 first** — so no message is lost even if the email step fails
4. Calls Resend API with `from: portfolio@resend.dev`, `to: TO_EMAIL` env var
5. Returns 200 on full success, 502 if Resend fails but D1 save succeeded

> The 2000-character cap visitors see is currently **client-side only** — the `maxlength` attribute and the live counter in `contact.astro` (see `src/lib/messageCounter.ts` below). The server doesn't reject long messages; adding that check is out of this extension's scope (see DECISIONS.md).

### `src/pages/api/external-data.ts`
Three-layer resilience:
1. **Cache API** — `caches.default.match(cacheKey)` returns cached response if hit (TTL 10 min)
2. **Live fetch** — `fetchWithTimeout(url, token, 5000)` calls `api.github.com/users/neeha-png`
3. **Mock fallback** — static object returned if both upstream layers fail

### `src/lib/messageCounter.ts` (Extension 5)
Pure function, no DOM/network dependencies — built test-first:
```
getCounterState(length: number, max = MAX_MESSAGE_LENGTH)
  → { text: "42 / 2000", isNearLimit: boolean }
```
`isNearLimit` trips at 90% of `max`. `contact.astro`'s client script calls this on every `input` event on `#message` and writes `text`/color into the `#message-counter` span. Covered by `src/lib/messageCounter.test.ts` (Vitest) and indirectly by `e2e/contact-form.spec.ts` (Playwright).

### `playwright.config.ts` / `e2e/*.spec.ts` (Extension 5)
`webServer` runs `npm run preview` (full `astro build` + real `wrangler dev`, not `astro dev`) so E2E exercises the actual Worker runtime and its D1/KV/AI bindings rather than `astro dev`'s proxied versions. Chromium only, in the interest of CI speed (see DECISIONS.md).
- `contact-form.spec.ts`: asserts the live counter, then stubs `POST /api/contact` via `page.route()` to assert the frontend's success-state handling (banner text, form reset, counter reset) without calling the real Resend API or writing to D1.
- `dark-mode.spec.ts`: seeds a known `theme=light` cookie via `context.addCookies()` (so the test doesn't depend on the browser's system color-scheme), clicks `#themeToggle`, reloads, and asserts the `dark` class on `<html>` survives — proving the cookie round-trip through `Layout.astro`'s server-side read actually works, not just the client-side toggle.

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

### Example: Pull request triggers CI (Extension 5)

```
1. Developer pushes feat/ext-5-automated-testing, opens a PR into main

2. GitHub Actions (ci.yml) triggers on pull_request
   → npm ci

3. Unit layer
   → npm run test:unit (Vitest)
   → src/lib/messageCounter.test.ts runs against messageCounter.ts directly
   → Fails fast, no browser/network involved

4. E2E layer
   → npx playwright install --with-deps chromium
   → npm run test:e2e (Playwright)
       → webServer runs `npm run preview` (astro build + wrangler dev, :8787)
       → contact-form.spec.ts + dark-mode.spec.ts run against the real Worker

5. Any failure
   → Job exits non-zero → PR status check = failure
   → Playwright HTML report uploaded as a workflow artifact for debugging
   → GitHub blocks the merge button (required status check)

6. All green
   → Status check = success
   → makhil006's approval still required (required reviewer) before merge unlocks
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
        ├── npm run lint --if-present   (no lint script configured yet — no-op)
        ├── npm run test:unit           (Vitest)
        ├── npx playwright install --with-deps chromium
        ├── npm run test:e2e            (Playwright, against real wrangler dev)
        └── upload playwright-report/ artifact on failure

Push to main
  └─► deploy.yml
        ├── npm ci
        ├── astro build → dist/
        └── wrangler deploy (reads CLOUDFLARE_API_TOKEN secret)
```

Secrets managed via GitHub repository secrets → never in source code. Branch protection on `main` requires the `ci.yml` check to pass and an approving review from `makhil006` before merging (see HLD.md's Testing & CI Infrastructure section for the full sequence diagram).

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
