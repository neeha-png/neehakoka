// contact.ts — Contact form submission handler.
// Validates input, saves the submission to D1, and sends an email via Resend.
// Defenses layered in order:
//   1. IP rate-limiting (D1-backed, 3 submissions/IP/hour)
//   2. Cloudflare Turnstile bot-protection token verification
//   3. Input sanitization — max lengths, XSS payload rejection, HTML stripping
//   4. D1 save with parameterised query (SQL-injection safe)
//   5. Resend email notification

import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { rateLimitByIp } from '../../lib/rateLimit';

// ─── Sanitization helpers ────────────────────────────────────────────────────

const MAX_NAME_LEN    = 100;
const MAX_EMAIL_LEN   = 254;  // RFC 5321 maximum
const MAX_MESSAGE_LEN = 2000;

// Detects common XSS/injection patterns BEFORE stripping.
// We reject rather than silently strip so that legitimate users never see
// their data mangled, and attackers get a clear 400 rather than a successful
// store that might surface in the admin panel later.
function hasDangerousPayload(str: string): boolean {
  return /<script|javascript:|on\w+\s*=|<iframe|<object|<embed|<svg\s*[\/>]|data:text\/html/i.test(str);
}

// Strips any remaining HTML tags and trims whitespace.
// Used as a final defense-in-depth pass before storing to D1 — even if the
// regex above has a blind spot, the stored value is rendered harmless.
function stripHtml(str: string): string {
  return str.replace(/<[^>]*>/g, '').trim();
}

// ─── Turnstile verification ───────────────────────────────────────────────────

// Verifies the Cloudflare Turnstile challenge token against the siteverify API.
// The secret key MUST be stored as a wrangler secret (not in vars):
//   wrangler secret put TURNSTILE_SECRET_KEY
// If the secret is not configured we skip verification so dev/CI builds
// don't break — log a warning so it's visible in observability.
async function verifyTurnstile(token: string, clientIp: string): Promise<boolean> {
  const secretKey = (env as any).TURNSTILE_SECRET_KEY as string | undefined;
  if (!secretKey) {
    console.warn('TURNSTILE_SECRET_KEY not set — skipping bot verification');
    return true;
  }
  if (!token) return false;

  const resp = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      secret: secretKey,
      response: token,
      // Passing the real client IP lets Cloudflare detect IP-spoofed token reuse
      remoteip: clientIp || undefined,
    }),
  });

  const result = await resp.json() as { success: boolean; 'error-codes'?: string[] };
  if (!result.success) {
    console.warn('Turnstile rejected token, error-codes:', result['error-codes']);
  }
  return result.success;
}

// ─── Route handler ────────────────────────────────────────────────────────────

export const POST: APIRoute = async ({ request }) => {
  try {
    // ── Defense 1: IP rate limiting ───────────────────────────────────────────
    // Block IPs that have submitted more than 3 contact forms in the past hour.
    const limiter = await rateLimitByIp(request, 'contact', 3);
    if (!limiter.allowed) {
      return new Response(
        JSON.stringify({ error: 'Rate limit exceeded. Try again later.' }),
        { status: 429, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // ── Parse body ────────────────────────────────────────────────────────────
    const data = await request.json() as {
      name?: unknown;
      email?: unknown;
      message?: unknown;
      'cf-turnstile-response'?: unknown;
    };

    const name    = typeof data.name    === 'string' ? data.name    : '';
    const email   = typeof data.email   === 'string' ? data.email   : '';
    const message = typeof data.message === 'string' ? data.message : '';
    const turnstileToken = typeof data['cf-turnstile-response'] === 'string'
      ? data['cf-turnstile-response']
      : '';

    // ── Defense 2: Turnstile bot verification ─────────────────────────────────
    // Executed before any validation so bots are rejected before we spend CPU
    // parsing and validating their payload.
    const clientIp = request.headers.get('CF-Connecting-IP') ?? '';
    const botCheckPassed = await verifyTurnstile(turnstileToken, clientIp);
    if (!botCheckPassed) {
      return new Response(
        JSON.stringify({ error: 'Bot verification failed. Please complete the challenge and try again.' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // ── Defense 3a: Max-length enforcement ───────────────────────────────────
    // Reject oversized payloads before doing any string processing.
    // This prevents memory exhaustion and blocks spam payloads that pad fields
    // to bypass regex-based filters via sheer length.
    if (name.length > MAX_NAME_LEN) {
      return new Response(
        JSON.stringify({ error: `Name must be ${MAX_NAME_LEN} characters or fewer.` }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }
    if (email.length > MAX_EMAIL_LEN) {
      return new Response(
        JSON.stringify({ error: 'Email address is too long.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }
    if (message.length > MAX_MESSAGE_LEN) {
      return new Response(
        JSON.stringify({ error: `Message must be ${MAX_MESSAGE_LEN} characters or fewer.` }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // ── Defense 3b: XSS/injection payload detection ──────────────────────────
    // Reject requests that contain script tags, javascript: URIs, inline event
    // handlers, or dangerous HTML elements. We reject rather than silently strip
    // so that an attacker cannot probe which payloads survive sanitization.
    for (const [field, value] of [['name', name], ['email', email], ['message', message]] as const) {
      if (hasDangerousPayload(value)) {
        return new Response(
          JSON.stringify({ error: `Invalid characters detected in ${field}.` }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        );
      }
    }

    // ── Defense 3c: Strip residual HTML and validate presence / format ────────
    const safeName    = stripHtml(name);
    const safeEmail   = stripHtml(email);
    const safeMessage = stripHtml(message);

    if (!safeName || safeName.length < 2) {
      return new Response(
        JSON.stringify({ error: 'Name must be at least 2 characters long.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!safeEmail || !emailRegex.test(safeEmail)) {
      return new Response(
        JSON.stringify({ error: 'Please provide a valid email address.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!safeMessage || safeMessage.length < 10) {
      return new Response(
        JSON.stringify({ error: 'Message must be at least 10 characters long.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // ── Read required secrets ─────────────────────────────────────────────────
    const resendApiKey = (env as any).RESEND_API_KEY as string | undefined ?? null;
    const targetEmail  = (env as any).TO_EMAIL as string | undefined;

    if (!resendApiKey || !targetEmail) {
      console.error('Missing RESEND_API_KEY or TO_EMAIL environment variables.');
      return new Response(
        JSON.stringify({ error: 'Server configuration error. Please try again later.' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // ── Defense 4: D1 save with parameterised query (SQL-injection safe) ─────
    // Saving first ensures we never lose a message even if the email call fails.
    // The sanitized values (safeName, safeEmail, safeMessage) are stored, not the raw input.
    const db = (env as any).portfolio_db;
    await db.prepare(
      'INSERT INTO submissions (id, name, email, message, status, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(
      crypto.randomUUID(),
      safeName,
      safeEmail,
      safeMessage,
      'pending',
      new Date().toISOString()
    ).run();

    // ── Defense 5: Email via Resend ───────────────────────────────────────────
    // Values are HTML-escaped in the template to prevent stored XSS from
    // rendering in email clients that render HTML (belt-and-suspenders since
    // safeMessage already has tags stripped).
    const escape = (s: string) =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    const emailResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Portfolio Contact <onboarding@resend.dev>',
        to: targetEmail,
        subject: `New Portfolio Message from ${safeName}`,
        html: `<p><strong>Name:</strong> ${escape(safeName)}</p>
               <p><strong>Email:</strong> ${escape(safeEmail)}</p>
               <p><strong>Message:</strong> ${escape(safeMessage)}</p>`,
      }),
    });

    if (!emailResponse.ok) {
      const errorData = await emailResponse.json();
      console.error('Resend API Error:', errorData);
      return new Response(
        JSON.stringify({ error: 'Message saved but failed to send email notification.' }),
        { status: 502, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ message: 'Message sent successfully!' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Server Error:', error);
    return new Response(
      JSON.stringify({ error: 'An unexpected server error occurred.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
