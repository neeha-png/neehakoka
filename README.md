# Neeha Koka — Personal Portfolio

[![CI](https://github.com/neeha-png/neehakoka/actions/workflows/ci.yml/badge.svg)](https://github.com/neeha-png/neehakoka/actions/workflows/ci.yml)
[![Deploy](https://github.com/neeha-png/neehakoka/actions/workflows/deploy.yml/badge.svg)](https://github.com/neeha-png/neehakoka/actions/workflows/deploy.yml)

Personal portfolio and blog built with **Astro** deployed as a **Cloudflare Worker**, with a D1 database backend, public JSON API, external API integration, and an AI "Ask My Résumé" chatbot.

**Live site:** https://neehakoka.neehasm0.workers.dev

---

## Stack

| Layer | Technology |
|---|---|
| Framework | Astro 6 (SSR, server output) |
| Runtime | Cloudflare Workers |
| Database | Cloudflare D1 (SQLite) |
| Session store | Cloudflare KV |
| Email | Resend API |
| AI | Gemini 2.5 Flash Lite |
| CI/CD | GitHub Actions → Wrangler |

---

## Local Development

### Prerequisites
- Node.js >= 22.12.0
- A Cloudflare account with Workers and D1 enabled
- `wrangler` CLI (installed as a dev dependency)

### 1. Clone and install

```bash
git clone https://github.com/neeha-png/neehakoka.git
cd neehakoka
npm install
```

### 2. Set up local secrets

Copy the example env file and fill in your keys:

```bash
cp .dev.vars.example .dev.vars
```

Required variables in `.dev.vars`:

```
RESEND_API_KEY=re_...
ADMIN_USERNAME=admin
ADMIN_PASSWORD=your_password
GEMINI_API_KEY=AI...
TO_EMAIL=your@email.com
```

> `.dev.vars` is git-ignored. Never commit real secrets.

### 3. Apply D1 migrations locally

```bash
npx wrangler d1 migrations apply portfolio-db --local
```

### 4. Start the dev server

```bash
npm run dev
```

The site runs at `http://localhost:4321` with the Worker proxy at `http://localhost:8787`.

---

## Building

```bash
npm run build
```

Output goes to `dist/`. The Cloudflare adapter wraps static assets and the Worker entry point automatically.

---

## Deployment

Deployments are **automated via GitHub Actions** on every merge to `main`. Manual deploys should not be needed, but if required:

```bash
npm run build
npx wrangler deploy
```

Cloudflare secrets must be set via Wrangler, not committed to the repo:

```bash
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put GEMINI_API_KEY
```

### Apply D1 migrations to production

```bash
npx wrangler d1 migrations apply portfolio-db --remote
```

---

## Project Structure

```
src/
  pages/          # Astro pages + /api/* Worker routes
  layouts/        # Shared HTML shell (OG tags, dark mode, skip link)
  components/     # ChatWidget and reusable UI
  lib/            # rateLimit.ts and shared utilities
  data/           # cv.ts (chatbot grounding context)
  content/blog/   # Markdown blog posts
migrations/       # D1 SQL migration files (checked in)
scripts/          # run-evals.ts — AI chatbot evaluation suite
design/           # Wireframe PNGs (Light/Dark, desktop/mobile)
```

---

## Running AI Evals

```bash
BASE_URL=https://neehakoka.neehasm0.workers.dev npx tsx scripts/run-evals.ts
```

Runs 20 test cases against the live `/api/chat` endpoint. See [EVALS.md](EVALS.md) for the full test plan and a sample report.

---

## Feature Branches

| Branch | Purpose |
|---|---|
| `feat/ext-1-backend-data` | D1 database, contact form, admin panel |
| `feat/ext-2-api-integration` | Public JSON API, OpenAPI spec, external fetch |
| `feat/ext-3-ai-feature-evals` | AI chatbot widget, Gemini integration, eval suite |

---

## Documentation

| File | Contents |
|---|---|
| [PLAN.md](plan.MD) | Stack choices, scope cuts, risks |
| [DESIGN.md](design.MD) | Color palette, typography, spacing |
| [DATA-MODEL.md](DATA-MODEL.md) | D1 schema, validation rules |
| [HLD.md](HLD.md) | Architecture diagram, component overview |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Code tour, request lifecycle |
| [DECISIONS.md](DECISIONS.md) | Scope cuts, AI tool log, scaling, v2 goals |
| [EVALS.md](EVALS.md) | AI eval suite docs, sample report |
| [TESTING.md](TESTING.md) | Manual browser and responsive test log |
