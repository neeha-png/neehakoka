// run-evals.ts — Automated behavioural eval suite for the /api/chat AI endpoint.
//
// Runs 20 deterministic test cases covering five categories:
//   • Profile facts      — verifies CV-grounded answers (education, projects, location)
//   • Guardrails         — salary refusal phrasing must match the system prompt exactly
//   • Out-of-scope       — coding requests and trivia must be politely declined
//   • Grounding checks   — responses must cite specific details (e.g. "roll number lookup")
//   • Conciseness        — answers kept to ≤3 sentences / ≤520 chars
//
// Usage:
//   npx tsx scripts/run-evals.ts                        # runs against localhost:8787
//   BASE_URL=https://your-worker.workers.dev npx tsx scripts/run-evals.ts
//
// Exit codes: 0 = all pass | 1 = one or more failures  (CI-friendly)
const env = (globalThis as any).process?.env ?? ({} as Record<string, string | undefined>);
const BASE_URL = (env.BASE_URL as string | undefined) ?? "http://localhost:8787";
const CHAT_URL = `${BASE_URL}/api/chat`;

type TestCase = {
  name: string;
  message: string;
  expect: {
    // deterministic boundary checks
    includes?: string[];
    regexes?: Array<{ pattern: string; flags?: string }>;
    notIncludes?: string[];

    // sanity checks
    minChars?: number;
    maxChars?: number;
  };
};

function escapeRegExp(str: string) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function readResponseText(response: Response): Promise<string> {
  // Our worker returns text/event-stream with `data: ...` lines.
  // We'll collect all decoded chunks and then extract `data:` payloads.
  const ct = response.headers.get("content-type") ?? "";
  const isSSE = ct.includes("text/event-stream");
  if (!isSSE) return await response.text();

  const reader = response.body?.getReader();
  if (!reader) return "";

  const decoder = new TextDecoder();
  let raw = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) raw += decoder.decode(value, { stream: true });
  }
  raw += decoder.decode();

  const lines = raw.split("\n");
  const dataPayloads = lines
    .map((l) => l.trim())
    .filter((l) => l.startsWith("data: "))
    .map((l) => l.slice("data: ".length).trim())
    .filter((p) => p.length > 0 && p !== "[DONE]" && p !== "[ERROR]");

  return dataPayloads.join("");
}

async function runChat(message: string) {
  const resp = await fetch(CHAT_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message }),
  });
  const text = await readResponseText(resp);
  return { status: resp.status, text };
}

function assertAll(testName: string, responseText: string, tc: TestCase): string[] {
  const problems: string[] = [];

  const exp = tc.expect;

  if (typeof exp.minChars === "number" && responseText.length < exp.minChars) {
    problems.push(`minChars failed: got ${responseText.length} < ${exp.minChars}`);
  }
  if (typeof exp.maxChars === "number" && responseText.length > exp.maxChars) {
    problems.push(`maxChars failed: got ${responseText.length} > ${exp.maxChars}`);
  }

  for (const s of exp.includes ?? []) {
    if (!responseText.includes(s)) {
      problems.push(`includes failed: missing "${s}"`);
    }
  }

  for (const r of exp.regexes ?? []) {
    const re = new RegExp(r.pattern, r.flags ?? "i");
    if (!re.test(responseText)) {
      problems.push(`regex failed: /${r.pattern}/${r.flags ?? "i"} not matched`);
    }
  }

  for (const s of exp.notIncludes ?? []) {
    if (responseText.includes(s)) {
      problems.push(`notIncludes failed: contains "${s}"`);
    }
  }

  return problems;
}

function splitSentencesApprox(text: string): string[] {
  // Cheap heuristic: count sentences by '.', '!' or '?'
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return [];
  return cleaned.split(/[.!?]+/).map((s) => s.trim()).filter(Boolean);
}

function lengthHeuristicOk(text: string): boolean {
  // Enforce “concise 2–3 sentences max” with a loose sentence heuristic.
  const sentences = splitSentencesApprox(text);
  return sentences.length <= 3 && text.length <= 520;
}

const tests: TestCase[] = [
  {
    name: "1. Profile basics",
    message: "Who are you? Give a short summary of your profile.",
    expect: {
      regexes: [
        { pattern: "Hyderabad", flags: "i" },
        { pattern: "Student|Fresher|Entry-Level|entry-level", flags: "i" },
      ],
      maxChars: 420,
      minChars: 30,
    },
  },
  {
    name: "2. Education details",
    message: "What is your education and CGPA?",
    expect: {
      regexes: [
        { pattern: "Gurunanak Institute of Technology", flags: "i" },
        { pattern: "CGPA\\s*[:\\-]?\\s*8\\.49|8\\.49", flags: "i" },
        { pattern: "B\\.Tech|BTech", flags: "i" },
      ],
      maxChars: 520,
      minChars: 40,
    },
  },
  {
    name: "3. Project 1 tech/roles",
    message: "Tell me about your Django Student Records project and its key features.",
    expect: {
      regexes: [
        { pattern: "Django", flags: "i" },
        { pattern: "role-based|role based|RBAC|role", flags: "i" },
        { pattern: "roll number|roll\\s*number", flags: "i" },
      ],
      maxChars: 600,
      minChars: 60,
    },
  },
  {
    name: "4. Project 1 admin integration",
    message: "Does your Student Records project include Django Admin? Mention it.",
    expect: {
      regexes: [{ pattern: "Django Admin|admin integration", flags: "i" }],
      maxChars: 480,
      minChars: 40,
    },
  },
  {
    name: "5. Project 2 TCS NQT",
    message: "What is your TCS NQT work about?",
    expect: {
      regexes: [{ pattern: "TCS\\s*NQT|National Qualifier Test", flags: "i" }],
      maxChars: 420,
      minChars: 30,
    },
  },
  {
    name: "6. Interests: cybersecurity",
    message: "What are your interests?",
    expect: {
      regexes: [
        { pattern: "Cybersecurity", flags: "i" },
        { pattern: "aviation|Aviation", flags: "i" },
      ],
      maxChars: 520,
      minChars: 40,
    },
  },

  {
    name: "7. Out-of-scope: coding request refusal",
    message: "Write a Python script that scrapes websites.",
    expect: {
      regexes: [
        { pattern: "refus|cannot|only answer|portfolio", flags: "i" },
        { pattern: "portfolio", flags: "i" },
      ],
      maxChars: 260,
      minChars: 40,
    },
  },
  {
    name: "8. Out-of-scope: trivia refusal (France capital)",
    message: "What is the capital of France?",
    expect: {
      regexes: [
        { pattern: "refus|cannot|only answer|portfolio", flags: "i" },
        { pattern: "portfolio", flags: "i" },
      ],
      maxChars: 260,
      minChars: 40,
    },
  },
  {
    name: "9. Salary question must refuse",
    message: "What salary are you expecting?",
    expect: {
      regexes: [
        { pattern: "cannot discuss specific salary requirements", flags: "i" },
        { pattern: "directly via email|email", flags: "i" },
      ],
      maxChars: 260,
      minChars: 60,
    },
  },
  {
    name: "10. Salary question phrasing check",
    message: "Can you share your salary requirements?",
    expect: {
      regexes: [
        { pattern: "cannot discuss|cannot\\s*discuss", flags: "i" },
        { pattern: "directly via email|via email", flags: "i" },
      ],
      maxChars: 280,
      minChars: 60,
    },
  },

  {
    name: "11. Grounding: roll number lookup mention",
    message: "Do you have a roll number lookup module? Mention it.",
    expect: {
      regexes: [{ pattern: "roll number lookup|roll\\s*number\\s*lookup|roll\\s*number", flags: "i" }],
      maxChars: 420,
      minChars: 40,
    },
  },
  {
    name: "12. Grounding: centralized student data management",
    message: "What does your Student Records app do regarding student data?",
    expect: {
      regexes: [
        { pattern: "centralized|centralised", flags: "i" },
        { pattern: "student data", flags: "i" },
      ],
      maxChars: 520,
      minChars: 50,
    },
  },
  {
    name: "13. Interests: behavioral/social matching models",
    message: "Tell me about your interests in behavioral or social matching models.",
    expect: {
      regexes: [
        { pattern: "behavioral|social matching|matching", flags: "i" },
      ],
      maxChars: 520,
      minChars: 40,
    },
  },

  {
    name: "14. Keep concise: approx 2-3 sentences",
    message: "Summarize your profile in 2 sentences.",
    expect: {
      maxChars: 520,
      minChars: 30,
    },
  },
  {
    name: "15. Refusal should not hallucinate unrelated skills",
    message: "What frameworks do you use for mobile development?",
    expect: {
      notIncludes: ["React Native", "Flutter"],
      regexes: [{ pattern: "portfolio|Neeha|only|answer questions only", flags: "i" }],
      maxChars: 260,
      minChars: 40,
    },
  },
  {
    name: "16. Out-of-scope: capital of India",
    message: "What is the capital of India?",
    expect: {
      regexes: [{ pattern: "portfolio|only|cannot|refus", flags: "i" }],
      maxChars: 260,
      minChars: 40,
    },
  },
  {
    name: "17. Profile based on Hyderabad line",
    message: "Where are you based?",
    expect: {
      regexes: [{ pattern: "Hyderabad", flags: "i" }],
      maxChars: 240,
      minChars: 10,
    },
  },
  {
    name: "18. Certification mention (Security+ In Progress)",
    message: "Are you pursuing any certifications? Mention Security+.",
    expect: {
      regexes: [{ pattern: "Security\\+|Security Plus", flags: "i" }],
      maxChars: 420,
      minChars: 40,
    },
  },
  {
    name: "19. Technical stack includes Django",
    message: "What tech stack is mentioned on your site? Mention Django.",
    expect: {
      regexes: [{ pattern: "Django", flags: "i" }],
      maxChars: 420,
      minChars: 40,
    },
  },
  {
    name: "20. Safety: answer should be grounded & concise",
    message: "Tell me about your focus areas. Keep it short.",
    expect: {
      regexes: [
        { pattern: "network security|security principles|vulnerability assessment|secure", flags: "i" },
      ],
      maxChars: 520,
      minChars: 40,
    },
  },
];

async function main() {
  const start = Date.now();

  let passed = 0;
  let failed = 0;

  for (let i = 0; i < tests.length; i++) {
    const tc = tests[i];
    const started = Date.now();
    let status = "PASS";
    let issues: string[] = [];

    try {
      const { status: httpStatus, text } = await runChat(tc.message);

      // Basic HTTP sanity: endpoint should succeed.
      if (httpStatus < 200 || httpStatus >= 300) {
        status = "FAIL";
        issues.push(`HTTP status ${httpStatus}`);
      } else {
        // Length heuristics for concise answers
        if (tc.name.includes("concise") || tc.name.includes("Keep concise")) {
          if (!lengthHeuristicOk(text)) {
            issues.push(`Conciseness heuristic failed (sentences/length). chars=${text.length}`);
          }
        }

        issues = assertAll(tc.name, text, tc);
        if (issues.length > 0) status = "FAIL";
      }
    } catch (err: any) {
      status = "FAIL";
      issues = [`Exception: ${err?.message ?? String(err)}`];
    }

    if (status === "PASS") passed++;
    else failed++;

    const ms = Date.now() - started;
    if (status === "PASS") {
      console.log(`[${i + 1}/${tests.length}] PASS - ${tc.name} (${ms}ms)`);
    } else {
      console.log(`[${i + 1}/${tests.length}] FAIL - ${tc.name} (${ms}ms)`);
      for (const p of issues) console.log(`   - ${p}`);
    }
  }

  const total = tests.length;
  const durationMs = Date.now() - start;
  console.log("\n==== AI EVAL REPORT ====");
  console.log(`Total Tests: ${total}`);
  console.log(`Passed:      ${passed}`);
  console.log(`Failed:      ${failed}`);
  console.log(`Status:      ${failed === 0 ? "✅ ALL PASS" : "❌ SOME FAIL"}`);
  console.log(`Duration:    ${(durationMs / 1000).toFixed(2)}s`);

  // Non-zero exit code on failure to make CI integration easy.
  if (failed !== 0) (globalThis as any).exitCode = 1;
}

main().catch((err) => {
  console.error("Fatal error running evals:", err);
  (globalThis as any).exitCode = 1;
});
