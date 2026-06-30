# Decisions

## Auth Mechanism — Session Cookie
Chose HttpOnly session cookies over JWT because:
- HttpOnly prevents JavaScript from reading the token (XSS protection)
- Secure + SameSite=Strict prevents CSRF attacks
- Sessions stored in D1 so they can be invalidated server-side

## At 10,000 Entries
- Add pagination (LIMIT/OFFSET) on the admin query
- Add index on created_at for faster sorting
- Add index on status for filtered queries
- Consider soft-delete (already have status field ready for this)

---

## Scope Cuts

The following features were cut to keep the project shippable within the time constraint:

- **OG image generation** — dynamic social preview images (e.g. via Satori/Canvas) were dropped. Static fallback `/og-default.png` is used instead. This is acceptable since text-only OG cards still render correctly on most platforms.
- **Visit counters / analytics** — Cloudflare Analytics Engine was considered but cut; the Worker already has observability enabled which covers error rates and request volumes.
- **Terminal-style UI** — a retro terminal hero was prototyped but removed in favour of a cleaner readable layout for recruiters who may be non-technical.
- **3rd project case study** — only two substantial personal projects exist at time of submission. A placeholder was not added; faking content is worse than an honest two-project showcase.
- **RSS autodiscovery** — the `<link rel="alternate" type="application/rss+xml">` tag in the `<head>` and a `/rss.xml` endpoint were deferred to v2 (see below).

---

## AI Transparency Tool Log

The following AI tools were used during development of this project:

| Tool | Purpose | Where used |
|---|---|---|
| **Claude (Anthropic)** | Drafting boilerplate Astro page structure, debugging D1 migration errors, reviewing session cookie implementation | Throughout all extensions |
| **Gemini 2.5 Flash Lite** | Production AI backend powering the "Ask My Résumé" chatbot at `/api/chat` | Extension 3 |
| **GitHub Copilot** | Inline autocomplete for repetitive TypeScript patterns (rate limiter, input validation) | Extension 1 & 2 |

All AI-generated code was reviewed, tested, and adapted before committing. No AI output was committed verbatim without understanding it. The CV grounding data in `src/data/cv.ts` was written by hand to ensure accuracy.

---

## v2 Goals

If this project were continued beyond the assignment:

1. **RSS feed** — add `@astrojs/rss` and expose `/rss.xml` so readers can subscribe to blog posts.
2. **Dynamic OG images** — generate per-page social preview cards using a Cloudflare Worker running Satori, so each blog post and project gets a unique share image.
3. **Password hashing** — replace plaintext `ADMIN_PASSWORD` env var comparison with a bcrypt-hashed value verified server-side, eliminating the risk of timing attacks.
4. **Migrate chatbot to Cloudflare Workers AI** — replace the Gemini API call with `env.AI.run("@cf/meta/llama-3-8b-instruct", ...)` to keep the entire stack on Cloudflare and avoid an external API dependency.
5. **Streamed chat responses** — switch `/api/chat` from `Response.json({ reply })` to a `ReadableStream` / Server-Sent Events response so the chatbot types out answers incrementally instead of waiting for the full generation.
6. **Full-text search on blog** — use D1 FTS5 extension to add a search box across blog post content.
7. **Automated Lighthouse CI** — add a `lighthouse-ci` step to the GitHub Actions workflow to catch performance or accessibility regressions before merge.