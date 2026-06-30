---
title: "Exploring Secure Systems Design"
pubDate: 2026-05-29
description: "Breaking down the core network infrastructure principles, threat mitigation, and data transparency barriers I am studying for my CompTIA Security+ validation."
---

# Exploring Secure Systems Design

Security is not a feature you bolt on at the end. It is a design constraint that shapes every decision from the data model to the HTTP headers. These are the principles I have been applying while building this portfolio.

## Threat Modelling First

Before writing a single line of code for the contact form, I asked: what could go wrong? The threats were:

- **Spam injection** — bots flooding the database with garbage
- **XSS via stored content** — malicious script tags in message fields reaching the admin view
- **Credential leakage** — secrets committed to git history

Each threat maps directly to a control: IP-based rate limiting, server-side HTML sanitisation, and Wrangler secrets respectively.

## HttpOnly Cookies Over localStorage

Session tokens live in HttpOnly + Secure + SameSite=Strict cookies. This means JavaScript cannot read them at all — XSS cannot steal a session even if an attacker somehow injects a script.

## Rate Limiting at the Edge

The rate limiter runs inside the Cloudflare Worker before any business logic executes. It uses Cloudflare D1 with a rolling one-hour window keyed on `route + IP`. Fail-open: if the database is unavailable, the request passes through rather than taking the site down.

## CompTIA Security+ Connection

These are not abstract exercises. They map directly to Security+ domains: threat assessment (domain 1), architecture and design (domain 2), and identity and access management (domain 4). Studying for the cert while building a real system is the fastest way to make the material stick.
