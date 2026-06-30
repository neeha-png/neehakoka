// logout.ts — Admin logout endpoint.
// Deletes the session from D1 (server-side invalidation) and expires the cookie.
// This means stolen tokens cannot be replayed after logout.

import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';

export const POST: APIRoute = async ({ request }) => {
  // Read the cookie header and extract the session token value
  const cookieHeader = request.headers.get('cookie') || '';
  const match = cookieHeader.match(/admin_session=([^;]+)/);
  const token = match ? match[1] : null;

  // If a token was present, delete it from D1 so it cannot be reused
  if (token) {
    const db = (env as any).portfolio_db;
    if (db) {
      await db.prepare("DELETE FROM admin_sessions WHERE token = ?")
        .bind(token)
        .run();
    }
  }

  // Expire the cookie on the client by setting Max-Age to 0 and a past Expires date
  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': 'admin_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Strict',
    },
  });
};
