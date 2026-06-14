# Data Model

## submissions
| Column | Type | Description |
|--------|------|-------------|
| id | TEXT | UUID primary key |
| name | TEXT | Sender's name (max 100 chars) |
| email | TEXT | Sender's email (validated format) |
| message | TEXT | Message body (max 2000 chars) |
| status | TEXT | 'pending', 'read', or 'archived' |
| created_at | DATETIME | Auto-set on insert |

## admin_sessions
| Column | Type | Description |
|--------|------|-------------|
| token | TEXT | Random UUID session token |
| expires_at | DATETIME | 2 hours from login |

## Validation
- All fields required, trimmed before saving
- Email must match standard format regex
- Name max 100 chars, message max 2000 chars
- HTML tags sanitized (< and > escaped) to prevent XSS