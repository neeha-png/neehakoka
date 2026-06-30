import { defineMiddleware } from 'astro:middleware';

// Generate a fresh cryptographic nonce per request and attach strict security headers.
// The nonce is stored in context.locals so Layout.astro can apply it to the
// inline theme-bootstrap <script is:inline> tag — without it that script would be
// blocked by the script-src directive and dark mode would break on first visit.
export const onRequest = defineMiddleware(async (context, next) => {
  // 128-bit random nonce, base64-encoded — unique per HTTP response
  const nonceBytes = new Uint8Array(16);
  crypto.getRandomValues(nonceBytes);
  const nonce = btoa(String.fromCharCode(...nonceBytes));
  context.locals.nonce = nonce;

  const response = await next();
  const headers = new Headers(response.headers);

  // Content-Security-Policy — engineering rationale per directive:
  //   default-src 'self'         — baseline: only load from our own origin
  //   script-src                 — allow our bundled JS files (self), the nonce for
  //                                the one inline script we own (theme bootstrap), and
  //                                Cloudflare Turnstile's loader CDN; nothing else
  //   style-src 'unsafe-inline'  — all styles are inline (no external stylesheet);
  //                                removing this would break the entire UI layout
  //   img-src data:              — favicon.svg and OG images are served as data URIs
  //   connect-src                — the Turnstile widget POSTs to Cloudflare internally
  //   frame-src                  — Turnstile renders its challenge inside a CF iframe
  //   object-src 'none'          — blocks <object>/<embed> (Flash, plugin injection)
  //   base-uri 'self'            — prevents <base href> hijacking of relative URLs
  //   form-action 'self'         — prevents forms from submitting to attacker origins
  //   upgrade-insecure-requests  — auto-upgrade http:// sub-requests to https://
  headers.set('Content-Security-Policy', [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' https://challenges.cloudflare.com`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data:`,
    `font-src 'self'`,
    `connect-src 'self' https://challenges.cloudflare.com`,
    `frame-src https://challenges.cloudflare.com`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `upgrade-insecure-requests`,
  ].join('; '));

  // Prevents the site from being loaded inside an <iframe> on any other domain.
  // Defends against clickjacking — attacker overlays an invisible iframe over a
  // legitimate-looking page to steal clicks/form submissions.
  headers.set('X-Frame-Options', 'DENY');

  // Prevents browsers from MIME-sniffing responses away from the declared Content-Type.
  // Without this, an attacker could upload a file named photo.jpg containing JS, and
  // some browsers would execute it as a script based on content heuristics.
  headers.set('X-Content-Type-Options', 'nosniff');

  // Controls how much referrer info is sent when navigating to external URLs.
  // strict-origin-when-cross-origin: sends full URL for same-origin navigation
  // but only the origin (not the path/query) for cross-origin, protecting any
  // sensitive parameters that might appear in the URL.
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Restricts browser APIs to what this site actually needs.
  // Prevents a compromised third-party script from silently activating the camera,
  // microphone, or geolocation API to spy on users.
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
});
