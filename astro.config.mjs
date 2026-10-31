import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

// platformProxy spins up a wrangler remote session during `astro build`,
// which requires wrangler auth and breaks CI. Disable it there; local dev
// can use `wrangler dev` directly to reach real Cloudflare bindings.
const isCI = !!process.env.CI;

export default defineConfig({
  site: 'https://neehakoka.neehasm0.workers.dev',
  output: 'server',
  adapter: cloudflare({
    imageService: 'compile',
    platformProxy: {
      enabled: !isCI
    },
    sessions: {
      enabled: false
    }
  })
});