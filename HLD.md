# High-Level Design (HLD)

## System Overview

This portfolio is a full-stack web application deployed as a single Cloudflare Worker. Every page and API route runs inside the same Worker process on Cloudflare's edge network, close to the visitor's location.

---

## Component Diagram

```
Browser
  |
  |  HTTPS
  v
+----------------------------------------------------------------------+
|                      Cloudflare Edge Network                         |
|                                                                      |
|  +-----------------------------------------------------------------+ |
|  |  Workers Rate Limiting (edge-native, before Worker CPU)         | |
|  |  CONTACT_RATE_LIMITER: 3 req / 60 s per IP                     | |
|  |  CHAT_RATE_LIMITER:    8 req / 60 s per IP                     | |
|  +-----------------------------------------------------------------+ |
|                              |                                       |
|  +-----------------------------------------------------------------+ |
|  |              Astro / Cloudflare Worker                          | |
|  |                                                                 | |
|  |  Astro Middleware  ──► CSP nonce generation, security headers   | |
|  |                                                                 | |
|  |  Static pages  ────► ASSETS binding                            | |
|  |  (pre-rendered HTML, CSS, JS)                                  | |
|  |                                                                 | |
|  |  API routes ──────────────────────────────────────────────┐    | |
|  |  /api/chat          │  /api/contact   │  /api/login       │    | |
|  |  /api/posts         │  /api/logout    │  /api/external-data│   | |
|  +───────────────────────────────────────────────────────────┘    | |
|                         │                                          | |
|         ┌───────────────┼───────────────┐                          | |
|         │               │               │                          | |
|         v               v               v                          | |
|  +-----------+   +------------+   +-----------+   +-------------+  | |
|  | Cloudflare|   | Cloudflare |   | Cloudflare|   | Cloudflare  |  | |
|  |    D1     |   |     KV     |   |   Cache   |   | Workers AI  |  | |
|  | (SQLite)  |   | (Sessions) |   |    API    |   |(llama-3.1-8b)|  | |
|  +-----------+   +------------+   +-----------+   +-------------+  | |
|   submissions     session tokens   GitHub data     AI chatbot       | |
|   rate_limits                      (10 min TTL)                     | |
+----------------------------------------------------------------------+
         |                                   |
         v                                   v
  +-------------+                   +------------------------+
  | Resend API  |                   | Cloudflare Turnstile   |
  | (email)     |                   | challenges.cloudflare  |
  +-------------+                   | .com/siteverify        |
                                    +------------------------+
                                           |
                                    +----------------+
                                    | GitHub API     |
                                    | (profile stats)|
                                    +----------------+
```

---

## Component Responsibilities

| Component | Technology | Purpose |
|---|---|---|
| **Workers Rate Limiting** | Cloudflare Rate Limiting API | Edge-native IP rate limiting enforced before Worker CPU allocates |
| **Astro Middleware** | `src/middleware.ts` (`defineMiddleware`) | Per-request CSP nonce generation; injects all security headers on every response |
| **Astro Worker** | Astro 6 + `@astrojs/cloudflare` | Renders pages, handles API routes, enforces D1 rate limits |
| **D1 (SQLite)** | Cloudflare D1 | Stores contact form submissions, admin sessions, rate-limit counters |
| **KV (Sessions)** | Cloudflare KV | Session store (binding: `SESSION`) |
| **Cache API** | Cloudflare Cache API | Edge-caches GitHub API responses for 10 minutes |
| **ASSETS** | Cloudflare Static Assets | Serves pre-rendered HTML, CSS, client JS, images |
| **Workers AI** | `@cf/meta/llama-3.1-8b-instruct` | Powers the "Ask My Résumé" AI chatbot via the `AI` binding |
| **Resend** | Resend transactional email | Delivers contact form submissions to inbox |
| **Turnstile** | Cloudflare Turnstile | Bot-protection challenge widget; token verified server-side via siteverify |
| **GitHub API** | api.github.com | Source of public profile stats shown on the site |

---

## Request Flow Summary

### Static page (e.g. `/about`)
```
Browser → Cloudflare Edge → ASSETS binding → cached HTML response
```
Pre-rendered at build time; no Worker execution needed for subsequent visits.

### Contact form (`POST /api/contact`)
```
Browser → Workers Rate Limiter (3/60 s) → Worker
       → Astro Middleware (CSP nonce + headers)
       → D1 Rate Limiter (3/hour backup)
       → Turnstile siteverify (bot check)
       → Max-length enforcement (100/254/2000 chars)
       → XSS payload detection (hasDangerousPayload)
       → HTML strip (stripHtml) + format validation
       → D1 INSERT submission (parameterised)
       → Resend email (HTML-escaped template)
       → 200 OK
```
Workers Rate Limiting drops flood attacks before any D1 or CPU cost. Turnstile rejects bot-automated submissions. D1 write always happens before Resend so no message is lost.

### AI chat (`POST /api/chat`)
```
Browser → Workers Rate Limiter (8/60 s) → Worker
       → Astro Middleware (CSP nonce + headers)
       → D1 Rate Limiter (6/hour backup)
       → Input guardrail (16 prompt-injection regex patterns)
       → Workers AI: llama-3.1-8b-instruct (stream: true)
       → bufferSseStream (assemble full response)
       → Output filter (7 violation patterns)
       → makeSseResponse → SSE to browser
```
Input guardrail prevents the model from ever seeing adversarial payloads. Output filter is the last line of defence against jailbreak success or hallucinated sensitive data.

### External data (`GET /api/external-data`)
```
Browser → Worker → Cache API hit? → return cached JSON (fast path)
                         ↓ miss
                   fetch github.com (5s timeout)
                         ↓ fail
                   return static mock data
```

---

## Security Controls

| Threat | Control | Layer |
|---|---|---|
| Bot / automated form submission | Cloudflare Turnstile widget + server-side `siteverify` | Defense 1 |
| XSS via stored contact input | `hasDangerousPayload()` rejection → `stripHtml()` → HTML-escaped email template | Defense 3 |
| Oversized / memory-exhaustion payloads | Max-length enforcement (name: 100, email: 254, message: 2000) | Defense 3 |
| Clickjacking | `X-Frame-Options: DENY` header (middleware) | Defense 2 |
| MIME-sniffing attacks | `X-Content-Type-Options: nosniff` header (middleware) | Defense 2 |
| Inline script injection (XSS via CSP bypass) | `Content-Security-Policy` with per-request nonce; no `unsafe-inline` | Defense 2 |
| Third-party script injection | CSP `script-src 'self' 'nonce-{n}' https://challenges.cloudflare.com` | Defense 2 |
| Prompt injection / jailbreak | 16-pattern regex input guardrail; rejects before AI binding is called | Defense 4 |
| System-prompt leakage / off-topic AI output | 7-pattern output filter; buffers full SSE stream before client sees it | Defense 4 |
| Volumetric flood (contact) | `CONTACT_RATE_LIMITER`: 3 req/60 s per IP (Workers edge, before CPU) | Defense 5 |
| Volumetric flood (chat) | `CHAT_RATE_LIMITER`: 8 req/60 s per IP (Workers edge, before CPU) | Defense 5 |
| Persistent spam / low-and-slow abuse | D1-backed IP rate limiter: 3/hour (contact), 6/hour (chat) | Defense 5 |
| SQL injection | Parameterised D1 queries via `.bind()` — no string interpolation | Defense 3 |
| Session hijacking | HttpOnly + Secure + SameSite=Strict cookie | Existing |
| Secret leakage | All secrets via `wrangler secret put`; never in code or `.dev.vars` | Existing |

---

## Scalability Notes

- **Zero cold starts**: Cloudflare Workers run on V8 isolates, not containers — startup is sub-millisecond.
- **Global edge**: Requests are served from the nearest Cloudflare PoP (~300 worldwide).
- **D1 read replicas**: D1 automatically replicates reads to regional edge nodes (write goes to primary).
- **Cache API**: GitHub stats are cached at the edge for 10 minutes, preventing upstream rate-limit hits from repeated visitors.
- **Edge rate limiting**: Workers Rate Limiting runs inside Cloudflare's network before the Worker script allocates any CPU — flood traffic is dropped at zero Worker cost.
