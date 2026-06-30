// login.js — Admin login endpoint.
// Validates username and password against Cloudflare environment secrets,
// then creates a secure server-side session stored in D1.

import { env } from "cloudflare:workers";

export const POST = async ({ request }) => {
  try {
    // Parse the submitted username and password from the request body
    const { username, password } = await request.json();

    // Read the expected credentials from Cloudflare secrets (never hardcoded)
    const adminPassword = env.ADMIN_PASSWORD;

    // Reject if either secret is missing or the credentials don't match
    if (!adminPassword || username !== env.ADMIN_USERNAME || password !== adminPassword) {
      return new Response(JSON.stringify({ error: "Invalid credentials" }), { status: 401 });
    }

    // Generate a high-entropy session token by concatenating two UUIDs
    const token = crypto.randomUUID() + crypto.randomUUID();

    // Session expires 2 hours from now
    const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();

    // Store the session token in D1 so it can be validated on subsequent admin requests
    const db = env.portfolio_db;
    await db.prepare("INSERT INTO admin_sessions (token, expires_at) VALUES (?, ?)")
      .bind(token, expiresAt)
      .run();

    // Return success and set an HttpOnly cookie so JavaScript cannot read the token.
    // Secure + SameSite=Strict prevents CSRF and transmission over plain HTTP.
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Set-Cookie": `admin_session=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=7200`
      }
    });

  } catch (error) {
    // Catch JSON parse errors or unexpected DB failures
    return new Response(JSON.stringify({ error: "Authentication failed" }), { status: 500 });
  }
};
