// contact.ts — Contact form submission handler.
// Validates input, saves the submission to D1, and sends an email via Resend.
// Rate limited to 3 submissions per IP per hour to prevent spam.

import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { rateLimitByIp } from '../../lib/rateLimit';

export const POST: APIRoute = async ({ request }) => {
  try {
    // Block IPs that have submitted more than 3 contact forms in the past hour
    const limiter = await rateLimitByIp(request, 'contact', 3);
    if (!limiter.allowed) {
      return new Response(
        JSON.stringify({ error: 'Rate limit exceeded. Try again later.' }),
        { status: 429, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // Parse the JSON body with explicit typing to avoid implicit any access
    const data = await request.json() as { name?: unknown; email?: unknown; message?: unknown };
    const name = typeof data.name === 'string' ? data.name : '';
    const email = typeof data.email === 'string' ? data.email : '';
    const message = typeof data.message === 'string' ? data.message : '';

    // Validate name — must be at least 2 characters after trimming whitespace
    if (!name || name.trim().length < 2) {
      return new Response(
        JSON.stringify({ error: 'Name must be at least 2 characters long.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Validate email format using a standard RFC-compatible regex
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRegex.test(email)) {
      return new Response(
        JSON.stringify({ error: 'Please provide a valid email address.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Validate message — must be at least 10 characters (no blank/spam submissions)
    if (!message || message.trim().length < 10) {
      return new Response(
        JSON.stringify({ error: 'Message must be at least 10 characters long.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Read required secrets — if missing, the Worker is misconfigured
    const resendApiKey = (env as any).RESEND_API_KEY as string | undefined ?? null;
    const targetEmail = (env as any).TO_EMAIL as string | undefined;

    if (!resendApiKey || !targetEmail) {
      console.error("Missing environment variables.");
      return new Response(
        JSON.stringify({ error: 'Server configuration error. Please try again later.' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Save the submission to D1 with a UUID primary key and 'pending' status.
    // Saving first ensures we never lose a message even if the email call fails.
    const db = (env as any).portfolio_db;
    await db.prepare(
      'INSERT INTO submissions (id, name, email, message, status, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(crypto.randomUUID(), name.trim(), email.trim(), message.trim(), 'pending', new Date().toISOString()).run();

    // Send an email notification to the portfolio owner via the Resend API
    const emailResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Portfolio Contact <onboarding@resend.dev>',
        to: targetEmail,
        subject: `New Portfolio Message from ${name}`,
        // Use the raw (non-sanitized) values here since Resend handles HTML escaping in the email client
        html: `<p><strong>Name:</strong> ${name}</p>
               <p><strong>Email:</strong> ${email}</p>
               <p><strong>Message:</strong> ${message}</p>`,
      }),
    });

    // If Resend fails, still report partial success — submission is already saved to D1
    if (!emailResponse.ok) {
      const errorData = await emailResponse.json();
      console.error("Resend API Error:", errorData);
      return new Response(
        JSON.stringify({ error: 'Message saved but failed to send email notification.' }),
        { status: 502, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Both D1 save and email send succeeded
    return new Response(
      JSON.stringify({ message: 'Message sent successfully!' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    // Catch unexpected errors — JSON parse failures, D1 errors, etc.
    console.error("Server Error:", error);
    return new Response(
      JSON.stringify({ error: `An unexpected server error occurred: ${error}` }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
