// submit.js — Legacy contact form submission endpoint (kept for backwards compatibility).
// New submissions use /api/contact instead, which also sends an email via Resend.
// This endpoint only saves to D1 — no email notification.

import { env } from "cloudflare:workers";
import { rateLimitByIp } from "../../lib/rateLimit";

export const POST = async ({ request }) => {
  try {
    // Block IPs that have submitted more than 3 times in the past hour
    const limiter = await rateLimitByIp(request, 'submit', 3);
    if (!limiter.allowed) {
      return new Response(JSON.stringify({ error: 'Rate limit exceeded. Try again later.' }), { status: 429, headers: { 'Content-Type': 'application/json' } });
    }

    // Parse the request body and destructure the three required fields
    const data = await request.json();
    let { name, email, message } = data;

    // All three fields must be present — return 400 if any are missing
    if (!name || !email || !message) {
      return new Response(JSON.stringify({ error: "All fields are required." }), { status: 400 });
    }

    // Trim whitespace from all inputs before validation and storage
    name = name.trim();
    email = email.trim();
    message = message.trim();

    // Validate email format using a standard pattern
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return new Response(JSON.stringify({ error: "Invalid email address format." }), { status: 400 });
    }

    // Enforce maximum lengths to prevent oversized payloads reaching the database
    if (name.length > 100 || message.length > 2000) {
      return new Response(JSON.stringify({ error: "Input exceeds maximum allowed length." }), { status: 400 });
    }

    // Sanitize HTML special characters to prevent stored XSS.
    // Replaces < and > so any injected script tags are rendered as plain text.
    const sanitize = (str) => str.replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const cleanName = sanitize(name);
    const cleanEmail = sanitize(email);
    const cleanMessage = sanitize(message);

    // Generate a UUID as the primary key and insert the sanitized submission into D1
    const id = crypto.randomUUID();
    const db = env.portfolio_db;

    await db.prepare(
      "INSERT INTO submissions (id, name, email, message) VALUES (?, ?, ?, ?)"
    )
    .bind(id, cleanName, cleanEmail, cleanMessage)
    .run();

    // Return success — the submission is now stored and awaiting admin review
    return new Response(JSON.stringify({ success: true, message: "Submission received successfully!" }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });

  } catch (error) {
    // Catch D1 errors, JSON parse failures, or any other unexpected exceptions
    return new Response(JSON.stringify({ error: "Server error processing your request." }), { status: 500 });
  }
};
