# Phase 1: Project Plan

## 🛠️ Selected Tech Stack
* **Frontend Framework:** Astro (Static Site Generator)
  * *Why:* Astro builds lightning-fast static pages, which guarantees a high Lighthouse performance score (target ≥ 90).
* **Deployment & Backend:** Cloudflare Workers (with Static Assets)
  * *Why:* It fulfills the core requirement to host both our static frontend and dynamic API routes under a single, fast, free-tier deployment.
* **Testing Framework:** Vitest
  * *Why:* It integrates seamlessly with modern JavaScript tools and runs incredibly fast in automation pipelines.

---

## 📄 Pages to Ship
1. **Home / Landing:** A clean, modern intro to who I am and a quick highlight of my best work.
2. **About Me:** A comprehensive profile details my journey, core technical focus, and achievements (designed to replace a traditional flat PDF resume).
3. **Projects (3 Case Studies):** Detailed walkthroughs structured strictly by: *Problem → Approach → Outcome → Future Iterations*.
4. **Blog (2 Posts):** Simple Markdown-based articles paired with a working RSS feed.
5. **Contact:** A user-friendly layout hosting a secure, validated message form connected to an API endpoint.
6. **Custom 404:** A helpful, intentionally designed page to route lost users back to safety.

---

## ✂️ Explicit Scope Cuts (To Fit 10–15 Hour Time-Box)
To ensure high-quality delivery within the required time limits, the following stretch goals are explicitly cut from Version 1:
* No automated OG image generation per blog post (standard static OG tags will be used instead).
* No real-time visit counters or database-backed guestbooks.
* No interactive homepage command terminal UI.

---

## ⚠️ Unknowns & Technical Risks
* **Form Spam Management:** Because this is deployed on a free-tier public URL, spam is a risk. I will need to implement server-side rate-limiting inside the Cloudflare Worker to protect the endpoint.
* **CI/CD Configuration:** Ensuring the secret Cloudflare API tokens smoothly authenticate within GitHub Actions without stalling the build.

