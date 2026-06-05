import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

export default defineConfig({
  output: 'server', // or 'hybrid'
  adapter: cloudflare({
    sessionKVBindingName: "" // 👈 Changed to an empty string to bypass the strict text requirement
  })
});