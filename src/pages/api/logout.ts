import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';

export const POST: APIRoute = async ({ request }) => {
  const cookieHeader = request.headers.get('cookie') || '';
  const match = cookieHeader.match(/admin_session=([^;]+)/);
  const token = match ? match[1] : null;

  // ✅ Delete session from DB so the token is dead server-side too
  if (token) {
    const db = (env as any).portfolio_db;
    if (db) {
      await db.prepare("DELETE FROM admin_sessions WHERE token = ?")
        .bind(token)
        .run();
    }
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      // ✅ Expire the cookie server-side as well
      'Set-Cookie': 'admin_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Strict',
    },
  });
};