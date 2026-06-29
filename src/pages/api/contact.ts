import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { rateLimitByIp } from '../../lib/rateLimit';

export const POST: APIRoute = async ({ request }) => {
  try {
    const limiter = await rateLimitByIp(request, 'contact', 3);
    if (!limiter.allowed) {
      return new Response(
        JSON.stringify({ error: 'Rate limit exceeded. Try again later.' }),
        { status: 429, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // ✅ Type the parsed JSON explicitly
    const data = await request.json() as { name?: unknown; email?: unknown; message?: unknown };
    const name = typeof data.name === 'string' ? data.name : '';
    const email = typeof data.email === 'string' ? data.email : '';
    const message = typeof data.message === 'string' ? data.message : '';

    if (!name || name.trim().length < 2) {
      return new Response(
        JSON.stringify({ error: 'Name must be at least 2 characters long.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRegex.test(email)) {
      return new Response(
        JSON.stringify({ error: 'Please provide a valid email address.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!message || message.trim().length < 10) {
      return new Response(
        JSON.stringify({ error: 'Message must be at least 10 characters long.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const resendApiKey = (env as any).RESEND_API_KEY as string | undefined ?? null;
    const targetEmail = (env as any).TO_EMAIL as string | undefined;

    if (!resendApiKey || !targetEmail) {
      console.error("Missing environment variables.");
      return new Response(
        JSON.stringify({ error: 'Server configuration error. Please try again later.' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const db = (env as any).portfolio_db;
    await db.prepare(
      'INSERT INTO submissions (id, name, email, message, status, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(crypto.randomUUID(), name.trim(), email.trim(), message.trim(), 'pending', new Date().toISOString()).run();

    // ✅ Send email AFTER saving
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
        html: `<p><strong>Name:</strong> ${name}</p>
               <p><strong>Email:</strong> ${email}</p>
               <p><strong>Message:</strong> ${message}</p>`,
      }),
    });

    if (!emailResponse.ok) {
      const errorData = await emailResponse.json();
      console.error("Resend API Error:", errorData);
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
    console.error("Server Error:", error);
    return new Response(
      JSON.stringify({ error: `An unexpected server error occurred: ${error}` }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};