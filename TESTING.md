# Manual Testing Log

All tests performed against the production deployment at **https://neehakoka.neehasm0.workers.dev** unless noted.

---

## Browsers Tested

| Browser | Version | OS |
|---|---|---|
| Chrome | 136 | Windows 11 |
| Firefox | 128 | Windows 11 |
| Edge | 136 | Windows 11 |
| Chrome Mobile | 136 | Android 14 (DevTools emulation) |

---

## Responsive Widths

| Label | Width |
|---|---|
| Mobile S | 375px |
| Mobile L | 425px |
| Tablet | 768px |
| Desktop | 1280px |
| Wide | 1440px |

---

## Page Tests

### Home (`/`)

| Test | 375px | 768px | 1280px | Notes |
|---|---|---|---|---|
| Hero section renders | PASS | PASS | PASS | |
| Nav collapses to stacked layout | PASS | PASS | N/A | Single column on mobile |
| Project cards expand/collapse | PASS | PASS | PASS | Toggle JS works |
| Blog previews expand/collapse | PASS | PASS | PASS | |
| Contact form submits | PASS | PASS | PASS | Success message shown |
| Contact form empty submit blocked | PASS | PASS | PASS | Client + server validation |
| Dark mode toggle works | PASS | PASS | PASS | Theme persists on reload |
| Skip-to-content link visible on Tab | PASS | PASS | PASS | Blue banner appears at top |

### About (`/about`)

| Test | 375px | 768px | 1280px | Notes |
|---|---|---|---|---|
| Education block renders | PASS | PASS | PASS | |
| Tech stack grid wraps correctly | PASS | PASS | PASS | |
| Certification block renders | PASS | PASS | PASS | |

### Projects (`/projects`)

| Test | 375px | 768px | 1280px | Notes |
|---|---|---|---|---|
| Project 1 (Django Records) renders | PASS | PASS | PASS | Problem/Approach/Outcome visible |
| Project 2 (Flask Lost-and-Found) renders | PASS | PASS | PASS | |
| Expand/collapse toggle | PASS | PASS | PASS | |

### Blog (`/blogs`)

| Test | 375px | 768px | 1280px | Notes |
|---|---|---|---|---|
| Post list renders | PASS | PASS | PASS | 2 posts shown |
| Post links navigate to `/blog/[slug]` | PASS | PASS | PASS | |
| Individual post renders Markdown | PASS | PASS | PASS | |
| Back link works | PASS | PASS | PASS | |

### Contact (`/contact`)

| Test | 375px | 768px | 1280px | Notes |
|---|---|---|---|---|
| Form renders | PASS | PASS | PASS | |
| Valid submission succeeds | PASS | PASS | PASS | Email received via Resend |
| Empty name blocked | PASS | PASS | PASS | Server returns 400 |
| Invalid email blocked | PASS | PASS | PASS | |
| Message < 10 chars blocked | PASS | PASS | PASS | |
| Script tag in message sanitized | ⚠️ | ⚠️ | ⚠️ | **Correction (Extension 5):** re-verified while building this extension — `src/pages/api/contact.ts` on this branch does not actually escape or sanitize `name`/`email`/`message` before the D1 insert or the Resend email body. The original PASS here was inaccurate. Sanitization is security-hardening work tracked separately, not in this testing extension's scope. |

### 404 Page

| Test | Result | Notes |
|---|---|---|
| Navigate to `/nonexistent` | PASS | Custom 404 page shown |
| Return home button works | PASS | |

---

## API Endpoint Tests

| Endpoint | Method | Input | Expected | Result |
|---|---|---|---|---|
| `/api/posts` | GET | — | 200 JSON array | PASS |
| `/api/posts/integrauth-part-1` | GET | valid slug | 200 JSON object | PASS |
| `/api/posts/nonexistent` | GET | bad slug | 404 JSON | PASS |
| `/api/contact` | POST | valid body | 201 saved to D1 | PASS |
| `/api/contact` | POST | empty body | 400 error | PASS |
| `/api/chat` | POST | in-scope question | 200 JSON reply | PASS |
| `/api/chat` | POST | salary question | 200 refusal message | PASS |
| `/api/external-data` | GET | — | 200 GitHub repos or fallback | PASS |
| `/api/login` | POST | valid creds | 200 + Set-Cookie | PASS |
| `/api/login` | POST | wrong password | 401 | PASS |
| `/api/logout` | POST | valid session | 200 + cookie cleared | PASS |

---

## Accessibility Tests

| Check | Tool | Result | Notes |
|---|---|---|---|
| Skip-to-content link | Manual (Tab key) | PASS | Appears on first Tab press |
| Keyboard nav through header links | Manual | PASS | Tab order follows DOM order |
| All images have alt text | Manual inspection | PASS | SVG icons use aria-label |
| Color contrast (dark bg #121826 / text #F3F4F6) | WebAIM Contrast Checker | PASS | Ratio 14.7:1 — exceeds WCAG AA |
| Color contrast (light bg #FFFFFF / text #1F2937) | WebAIM Contrast Checker | PASS | Ratio 15.8:1 |
| Form labels | Manual | PASS | Inputs have associated labels |
| Theme toggle aria-label | Manual | PASS | "Toggle Theme" announced |

---

## Dark Mode Tests

| Scenario | Result | Notes |
|---|---|---|
| System preference dark → page loads dark | PASS | `prefers-color-scheme` detected in inline script |
| Manual toggle switches theme | PASS | `dark` class toggled on `<html>` |
| Theme persists across page reload | PASS | **Correction (Extension 5):** persistence is actually a `theme` cookie (`Path=/; Max-Age=31536000; SameSite=Lax`), read server-side in `Layout.astro` before paint — not `localStorage` as originally logged here. Now covered by an automated test: `e2e/dark-mode.spec.ts`. |
| Dark header background applies | PASS | CSS variable `--header-bg` switches |

---

## Rate Limiting Tests

| Scenario | Result |
|---|---|
| 4th contact form submit within 1 hour blocked | PASS — 429 returned |
| 7th chat message within 1 hour blocked | PASS — error shown in widget |

---

## Automated Test Suite (Extension 5)

Everything above this section is the pre-existing manual log. This section documents the automated suite added on top of it — Vitest for unit tests, Playwright for E2E.

### What's covered

| Layer | File | Covers |
|---|---|---|
| Unit (Vitest) | `src/lib/messageCounter.test.ts` | `getCounterState()` — text formatting, default max, the 90%-of-max near-limit threshold (below, at, and above) |
| E2E (Playwright) | `e2e/contact-form.spec.ts` | Live character counter while typing; full fill → submit → success-state flow (banner text, form reset, counter reset) |
| E2E (Playwright) | `e2e/dark-mode.spec.ts` | Toggling theme updates `<html class="dark">`; the change survives a full page reload (cookie round-trip through the server) |

### What's not covered (and why)

See `DECISIONS.md` for the full rationale. Briefly: real Resend email delivery, real D1 writes from the contact form, the AI chatbot (already covered separately by `EVALS.md`/`scripts/run-evals.ts`), non-Chromium browsers, and load/performance testing are all out of scope for this suite.

### Running locally

```bash
# Unit tests only (fast, no browser, no server)
npm run test:unit

# E2E tests only — automatically builds and starts `wrangler dev` on :8787 first
npm run test:e2e

# Everything
npm test
```

Playwright's `webServer` config (`playwright.config.ts`) runs `npm run preview` (real `wrangler dev`, not `astro dev`) and reuses an already-running dev server locally (`reuseExistingServer: !process.env.CI`) — so if you already have `npm run preview` running in another terminal, `npm run test:e2e` attaches to it instead of rebuilding.

To debug a failing E2E test interactively: `npx playwright test --ui` or `npx playwright test --debug`.

### Running in CI

`.github/workflows/ci.yml` runs `npm run test:unit`, installs the Chromium browser (`npx playwright install --with-deps chromium`), then `npm run test:e2e` — on every pull request targeting `main`. A failure in either layer fails the required status check and blocks the merge button; the Playwright HTML report is uploaded as a workflow artifact (`playwright-report/`, 7-day retention) for debugging a CI-only failure.
