// src/pages/api/login.js
import { env } from "cloudflare:workers";

export const POST = async ({ request }) => { // removed locals argument
  try {
    const { username, password } = await request.json();

    const adminPassword = env.ADMIN_PASSWORD;

    if (!adminPassword || username !== env.ADMIN_USERNAME || password !== adminPassword) {
      return new Response(JSON.stringify({ error: "Invalid credentials" }), { status: 401 });
    }
    const token = crypto.randomUUID() + crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();

    const db = env.portfolio_db;
    await db.prepare("INSERT INTO admin_sessions (token, expires_at) VALUES (?, ?)")
      .bind(token, expiresAt)
      .run();

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Set-Cookie": `admin_session=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=7200`
      }
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: "Authentication failed" }), { status: 500 });
  }
};