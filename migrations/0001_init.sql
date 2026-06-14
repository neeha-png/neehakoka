-- migrations/0001_init.sql
// ✅ Replace the DB insert block with this
const db = (env as any).portfolio_db;
if (db) {
  const id = crypto.randomUUID(); // Built into Cloudflare Workers, no import needed
  await db.prepare(
    "INSERT INTO submissions (id, name, email, message, status, created_at) VALUES (?, ?, ?, ?, 'pending', datetime('now'))"
  )
  .bind(id, name.trim(), email.trim(), message.trim())
  .run();
} else {
  console.error("D1 binding 'portfolio_db' not found.");
}
-- Table to store contact form submissions
CREATE TABLE IF NOT EXISTS submissions (
    id TEXT PRIMARY KEY,               -- We will use secure UUIDs/ULIDs instead of numeric IDs
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    message TEXT NOT NULL,
    status TEXT DEFAULT 'pending',     -- For moderation: 'pending', 'read', or 'archived'
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Table to store active admin sessions
CREATE TABLE IF NOT EXISTS admin_sessions (
    token TEXT PRIMARY KEY,            -- High-entropy secure session token
    expires_at DATETIME NOT NULL
);