import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

export default defineConfig({
  output: 'server', // or 'hybrid'
  adapter: cloudflare({
    sessionKVBindingName: false // 👈 Add this line to stop generating the KV database
  })
});