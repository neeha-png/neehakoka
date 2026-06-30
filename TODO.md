# TODO

- [ ] Add Gemini-backed chat API route: `src/pages/api/chat.ts`
- [x] Add Gemini profile context: `src/lib/profileContext.ts`
- [x] Add floating chat widget UI component: `src/components/ChatWidget.astro`
- [x] Mount chat widget on homepage: update `src/pages/index.astro`
- [ ] Verify build/dev (`npm run dev`) and basic request flow
- [ ] Extension 3: AI Feature + Evals
  - [x] Create `src/data/cv.ts` with resume grounding data
  - [x] Implement streaming `POST /api/chat` in `src/pages/api/chat.ts` using `env.AI.run()` + SSE
  - [x] Add Workers AI binding (`env.AI`) in `wrangler.jsonc`
  - [x] Create eval harness `scripts/run-evals.ts` with 20 test cases
  - [ ] Verify evals by running `node scripts/run-evals.ts` against `http://localhost:8787/api/chat` (report: Total/Passed/Failed)
- [x] Document required env var: `GEMINI_API_KEY`


