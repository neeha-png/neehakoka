// status.ts — PATCH /api/submissions/status
// Updates a submission's moderation status (pending → read → archived).
// Requires a valid admin session cookie — rejects unauthenticated requests.

import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';

const VALID_STATUSES = ['pending', 'read', 'archived'] as const;
type Status = typeof VALID_STATUSES[number];

export const PATCH: APIRoute = async ({ request }) => {
  const db = (env as any).portfolio_db;
  if (!db) {
    return new Response(JSON.stringify({ error: 'Database unavailable.' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Verify the admin session cookie before allowing any status mutation
  const cookieHeader = request.headers.get('cookie') ?? '';
  const tokenMatch = cookieHeader.match(/admin_session=([^;]+)/);
  const token = tokenMatch?.[1] ?? null;

  if (!token) {
    return new Response(JSON.stringify({ error: 'Unauthorised.' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const session = await db
    .prepare("SELECT token FROM admin_sessions WHERE token = ? AND expires_at > datetime('now')")
    .bind(token)
    .first();

  if (!session) {
    return new Response(JSON.stringify({ error: 'Session expired or invalid.' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Parse and validate the request body
  const body = (await request.json()) as { id?: string; status?: string };
  const id = String(body?.id ?? '').trim();
  const status = String(body?.status ?? '').trim() as Status;

  if (!id) {
    return new Response(JSON.stringify({ error: 'id is required.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!VALID_STATUSES.includes(status)) {
    return new Response(JSON.stringify({ error: `status must be one of: ${VALID_STATUSES.join(', ')}.` }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Update the submission row — returns no error if id doesn't exist (idempotent)
  await db
    .prepare('UPDATE submissions SET status = ? WHERE id = ?')
    .bind(status, id)
    .run();

  return new Response(JSON.stringify({ ok: true, id, status }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

// Reject non-PATCH methods
export const ALL: APIRoute = async () =>
  new Response(JSON.stringify({ error: 'Method not allowed.' }), {
    status: 405,
    headers: { 'Content-Type': 'application/json' },
  });
