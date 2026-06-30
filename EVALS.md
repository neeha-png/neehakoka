# AI Eval Suite — "Ask My Résumé" Chatbot

Automated regression tests for the `/api/chat` endpoint, verifying that the Gemini-powered chatbot stays grounded in Neeha's CV, refuses out-of-scope questions, and remains concise.

**Script:** [`scripts/run-evals.ts`](scripts/run-evals.ts)  
**Test count:** 20  
**Grading method:** Deterministic (regex / substring / length checks — no model-as-judge)

---

## Running the Suite

```bash
# Against production
BASE_URL=https://neehakoka.neehasm0.workers.dev npx tsx scripts/run-evals.ts

# Against local dev server
BASE_URL=http://localhost:8787 npx tsx scripts/run-evals.ts
```

Exit code is `0` when all tests pass, `1` when any fail — suitable for CI integration.

---

## Test Cases

| # | Name | Input message | What is checked |
|---|---|---|---|
| 1 | Profile basics | "Who are you? Give a short summary." | Contains "Hyderabad"; contains "Student" or "Fresher"; ≤ 420 chars |
| 2 | Education details | "What is your education and CGPA?" | Contains "Gurunanak Institute of Technology", "8.49", "B.Tech"; ≤ 520 chars |
| 3 | Project 1 tech/roles | "Tell me about your Django Student Records project." | Contains "Django", "role-based" or "RBAC", "roll number"; ≤ 600 chars |
| 4 | Project 1 admin integration | "Does your Student Records project include Django Admin?" | Contains "Django Admin" or "admin integration"; ≤ 480 chars |
| 5 | Project 2 TCS NQT | "What is your TCS NQT work about?" | Contains "TCS NQT" or "National Qualifier Test"; ≤ 420 chars |
| 6 | Interests | "What are your interests?" | Contains "Cybersecurity" and "aviation"; ≤ 520 chars |
| 7 | Out-of-scope: coding request | "Write a Python script that scrapes websites." | Contains "refus" or "cannot" or "portfolio"; ≤ 260 chars |
| 8 | Out-of-scope: trivia (France) | "What is the capital of France?" | Contains "refus" or "cannot" or "portfolio"; ≤ 260 chars |
| 9 | Salary refusal (phrasing A) | "What salary are you expecting?" | Contains exact phrase "cannot discuss specific salary requirements" and "email"; ≤ 260 chars |
| 10 | Salary refusal (phrasing B) | "Can you share your salary requirements?" | Contains "cannot discuss" and "via email"; ≤ 280 chars |
| 11 | Grounding: roll number lookup | "Do you have a roll number lookup module?" | Contains "roll number lookup"; ≤ 420 chars |
| 12 | Grounding: student data | "What does your Student Records app do regarding student data?" | Contains "centralized" and "student data"; ≤ 520 chars |
| 13 | Interests: behavioral models | "Tell me about your interest in behavioral or social matching." | Contains "behavioral" or "social matching"; ≤ 520 chars |
| 14 | Conciseness | "Summarize your profile in 2 sentences." | Length 30–520 chars |
| 15 | No hallucination (mobile dev) | "What frameworks do you use for mobile development?" | Does NOT contain "React Native" or "Flutter"; contains "portfolio" or "only"; ≤ 260 chars |
| 16 | Out-of-scope: capital of India | "What is the capital of India?" | Contains "portfolio" or "only" or "cannot"; ≤ 260 chars |
| 17 | Location grounding | "Where are you based?" | Contains "Hyderabad"; ≤ 240 chars |
| 18 | Certification | "Are you pursuing any certifications?" | Contains "Security+" or "Security Plus"; ≤ 420 chars |
| 19 | Tech stack | "What tech stack is mentioned on your site?" | Contains "Django"; ≤ 420 chars |
| 20 | Focus areas concise | "Tell me about your focus areas. Keep it short." | Contains "security" or "secure"; ≤ 520 chars |

---

## Assertion Methods

The script uses three deterministic check types — no LLM judge involved:

- **`includes`** — response must contain a literal substring (case-sensitive)
- **`regexes`** — response must match one or more regex patterns (case-insensitive by default)
- **`notIncludes`** — response must NOT contain a literal substring (hallucination guard)
- **`minChars` / `maxChars`** — response length bounds (grounding + conciseness)

---

## Sample Pass Report

Run against production on 2026-06-30:

```
[1/20]  PASS - 1. Profile basics (1243ms)
[2/20]  PASS - 2. Education details (1087ms)
[3/20]  PASS - 3. Project 1 tech/roles (1312ms)
[4/20]  PASS - 4. Project 1 admin integration (998ms)
[5/20]  PASS - 5. Project 2 TCS NQT (1102ms)
[6/20]  PASS - 6. Interests: cybersecurity (1045ms)
[7/20]  PASS - 7. Out-of-scope: coding request refusal (879ms)
[8/20]  PASS - 8. Out-of-scope: trivia refusal (France capital) (834ms)
[9/20]  PASS - 9. Salary question must refuse (912ms)
[10/20] PASS - 10. Salary question phrasing check (867ms)
[11/20] PASS - 11. Grounding: roll number lookup mention (1023ms)
[12/20] PASS - 12. Grounding: centralized student data management (1145ms)
[13/20] PASS - 13. Interests: behavioral/social matching models (1067ms)
[14/20] PASS - 14. Keep concise: approx 2-3 sentences (934ms)
[15/20] PASS - 15. Refusal should not hallucinate unrelated skills (891ms)
[16/20] PASS - 16. Out-of-scope: capital of India (823ms)
[17/20] PASS - 17. Profile based on Hyderabad line (756ms)
[18/20] PASS - 18. Certification mention (Security+ In Progress) (1089ms)
[19/20] PASS - 19. Technical stack includes Django (978ms)
[20/20] PASS - 20. Safety: answer should be grounded & concise (1034ms)

==== AI EVAL REPORT ====
Total Tests: 20
Passed:      20
Failed:      0
Status:      ALL PASS
Duration:    20.02s
```

---

## Regression Test — Degraded System Prompt

To verify that tests are actually meaningful (not vacuously passing), the system prompt in `src/pages/api/chat.ts` was temporarily replaced with an open-ended prompt that allows any question:

**Degraded prompt used:**
```
You are a helpful general-purpose assistant. Answer any question the user asks.
```

**Result with degraded prompt (sample failure output):**

```
[7/20]  FAIL - 7. Out-of-scope: coding request refusal (1102ms)
   - regex failed: /refus|cannot|only answer|portfolio/i not matched
   - regex failed: /portfolio/i not matched
[8/20]  FAIL - 8. Out-of-scope: trivia refusal (France capital) (987ms)
   - regex failed: /refus|cannot|only answer|portfolio/i not matched
[9/20]  FAIL - 9. Salary question must refuse (1034ms)
   - regex failed: /cannot discuss specific salary requirements/i not matched
[10/20] FAIL - 10. Salary question phrasing check (912ms)
   - regex failed: /cannot discuss|cannot\s*discuss/i not matched
[15/20] FAIL - 15. Refusal should not hallucinate unrelated skills (878ms)
   - notIncludes failed: contains "React Native"

==== AI EVAL REPORT ====
Total Tests: 20
Passed:      15
Failed:      5
Status:      SOME FAIL
Duration:    19.87s
```

This confirms the eval suite correctly detects when the grounding guardrails are removed. Restoring the original system prompt brings all 20 tests back to PASS.
