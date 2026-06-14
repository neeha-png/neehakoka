import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';

export const POST: APIRoute = async ({ request }) => {
  try {
    const data = await request.json();
    const { name, email, message } = data;

    if (!name || typeof name !== 'string' || name.trim().length < 2) {
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

    if (!message || typeof message !== 'string' || message.trim().length < 10) {
      return new Response(
        JSON.stringify({ error: 'Message must be at least 10 characters long.' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // ✅ INSERT INTO DATABASE — this was completely missing before
    const db = (env as any).portfolio_db;
    if (db) {
      await db.prepare(
        "INSERT INTO submissions (name, email, message, status, created_at) VALUES (?, ?, ?, 'new', datetime('now'))"
      )
      .bind(name.trim(), email.trim(), message.trim())
      .run();
    } else {
      console.error("D1 binding 'portfolio_db' not found.");
    }

    const resendApiKey = (env as any).RESEND_API_KEY;
    const targetEmail = (env as any).TO_EMAIL;

    if (!resendApiKey || !targetEmail) {
      console.error("Missing environment variables.");
      return new Response(
        JSON.stringify({ error: 'Server configuration error. Please try again later.' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

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
        JSON.stringify({ error: 'Failed to send message via email provider.' }),
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