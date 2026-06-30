/// <reference types="astro/client" />

// Extend Astro's built-in Locals interface so TypeScript knows that
// context.locals.nonce (set by src/middleware.ts on every request)
// is a string, not unknown. Without this, Astro.locals.nonce would
// be typed as any and could silently break if the middleware changes.
declare namespace App {
  interface Locals {
    nonce: string;
  }
}
