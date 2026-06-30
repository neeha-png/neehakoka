---
title: "Kicking Off My Software Engineering Portfolio"
pubDate: 2026-05-29
description: "An inside look into designing and architecting this portfolio site using Astro, layout structures, and clean CSS styling parameters."
---

# Kicking Off My Software Engineering Portfolio

Building a portfolio from scratch taught me more about web architecture in one week than months of reading tutorials. Here is what I learned.

## Why Astro?

I chose Astro for three reasons: it ships zero JavaScript by default, it runs natively on Cloudflare Workers via the `@astrojs/cloudflare` adapter, and its island architecture meant I could sprinkle in interactive components (like the AI chat widget) without committing to a full React bundle.

## Project Structure

The site follows a clean separation of concerns:

- `src/layouts/` — the single `Layout.astro` shell that wraps every page
- `src/pages/` — file-system routing; each `.astro` file maps to a URL
- `src/pages/api/` — server-side API routes running as Cloudflare Workers handlers
- `src/components/` — isolated UI pieces like the floating `ChatWidget`
- `src/data/cv.ts` — hardcoded CV context used to ground the AI chatbot

## Styling Approach

Rather than importing a CSS framework, I used inline styles throughout. This eliminates unused CSS entirely, makes each component self-contained and readable, and avoids specificity battles across a large stylesheet.

## What Comes Next

The next posts will cover how I wired up Cloudflare D1 for persistent storage, how the rate limiter works, and the AI eval suite that validates the chatbot responses.
