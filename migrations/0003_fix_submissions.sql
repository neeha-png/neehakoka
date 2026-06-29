-- Recreate submissions with the correct schema (id TEXT PRIMARY KEY, status DEFAULT 'pending').
-- The original table was created with id INTEGER AUTOINCREMENT which conflicts with UUID inserts.
DROP TABLE IF EXISTS submissions;
CREATE TABLE submissions (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    message TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
