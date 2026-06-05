# TODO - Fix blogs page

- [ ] Update `src/pages/blogs.astro` to remove broken double `getCollection` fetch (single try/catch).
- [ ] Make blog card links use the same slug used by the dynamic route (`/blog/${post.id}`).
- [ ] Harden rendering: safely handle missing `title/description/pubDate`.
- [ ] Simplify panel toggle JS.
- [x] Run `npm run build` to verify the site compiles and blog pages route correctly. (blocked by PowerShell execution policy for npm/npx scripts)


