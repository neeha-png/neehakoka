# Decisions

## Auth Mechanism — Session Cookie
Chose HttpOnly session cookies over JWT because:
- HttpOnly prevents JavaScript from reading the token (XSS protection)
- Secure + SameSite=Strict prevents CSRF attacks
- Sessions stored in D1 so they can be invalidated server-side

## At 10,000 Entries
- Add pagination (LIMIT/OFFSET) on the admin query
- Add index on created_at for faster sorting
- Add index on status for filtered queries
- Consider soft-delete (already have status field ready for this)