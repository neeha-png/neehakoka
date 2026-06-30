// chat.ts — "Ask My Résumé" AI chatbot endpoint.
// Accepts a POST with { message, history[] } and streams the reply via SSE.
// Uses Cloudflare Workers AI (llama-3.1-8b-instruct) via the env.AI binding.
//
// Security layers added for Extension 4 (adversarial hardening):
//   • Input Guardrail  — rejects prompt-injection attempts before hitting the model
//   • Output Filter    — buffers the full AI response and redacts policy violations
//                        before emitting the SSE stream to the client

import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { rateLimitByIp } from '../../lib/rateLimit';
import { cvMarkdown } from '../../data/cv';

type ChatMessage = { role: 'user' | 'assistant'; content: string };
type RequestBody = { message: string; history?: ChatMessage[] };

const AI_MODEL = '@cf/meta/llama-3.1-8b-instruct';

const systemPrompt = [
  'Act as an "Ask my Résumé" chatbot.',
  'Ground ALL answers strictly in the provided CV data below.',
  'If asked about salary, decline gracefully: "I cannot discuss specific salary requirements here, please reach out directly via email".',
  'If asked an out-of-scope question (e.g., "Write a Python script", "What is the capital of France?"), refuse politely.',
  'Keep answers concise (2-3 sentences max).',
  '\n---\nCV DATA:\n' + cvMarkdown,
].join('\n');

// ─── Input Guardrail ──────────────────────────────────────────────────────────
// Checks the user's message for known prompt-injection attack patterns BEFORE
// sending it to the AI model.
//
// Engineering rationale: the model's system prompt is a soft instruction, not
// a hard security boundary. A sufficiently crafted user turn can override it
// ("ignore previous instructions", DAN jailbreak, etc.). Blocking these patterns
// client-side prevents the model from even seeing the adversarial payload, which
// is a stronger guarantee than relying on the model to self-police.
//
// The patterns here are intentionally conservative — false-positive refusals on
// legitimate questions are preferable to allowing a successful injection that
// reveals the system prompt or turns the bot into a general-purpose assistant.

const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?previous\s+(instructions?|prompts?|context|directives?)/i,
  /reveal\s+(your\s+)?(system\s*prompt|instructions?|context|training|configuration)/i,
  /you\s+are\s+now\s+(a|an|the)\s/i,
  /forget\s+(everything|all\s+previous|your\s+(instructions?|role|purpose))/i,
  /pretend\s+(you\s+are|to\s+be|that\s+you('re|\s+are))/i,
  // Allow "act as an 'Ask my résumé'" but block anything else
  /act\s+as\s+(?!an?\s+"?ask\s+my|an?\s+r[ée]sum[ée])/i,
  /\bjailbreak\b/i,
  // DAN ("Do Anything Now") jailbreak family
  /\bDAN\b/,
  /new\s+(role|persona|instructions?|directive|task|goal|objective)/i,
  /system\s*:\s*you\s+(are|must|should|will)/i,
  // [[SYSTEM]] and similar injection delimiters
  /\[\[.{0,40}?\]\]/,
  /override\s+(the\s+)?(system|instructions?|prompt|guidelines?|rules?)/i,
  /disregard\s+(all\s+)?(previous|prior|earlier)\s+/i,
  /sudo\s+mode|developer\s+mode|god\s+mode|debug\s+mode/i,
  // Attempts to extract raw prompt by asking for a repeat/echo
  /repeat\s+(everything|all|your\s+(instructions?|system\s*prompt))/i,
  /what\s+(are\s+)?your\s+(exact\s+)?(instructions?|rules?|system\s*prompt)/i,
];

function isPromptInjection(text: string): boolean {
  return INJECTION_PATTERNS.some((p) => p.test(text));
}

// ─── Stream buffering ─────────────────────────────────────────────────────────
// Workers AI returns a ReadableStream of SSE events.
// We buffer the entire response so the output filter can inspect the complete
// text before any of it reaches the client. The trade-off is that users see the
// response appear all at once rather than word-by-word — acceptable for short
// 2-3 sentence answers.

async function bufferSseStream(stream: ReadableStream): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let raw = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) raw += decoder.decode(value, { stream: true });
  }
  raw += decoder.decode();

  // SSE format: each line is "data: <JSON>\n\n". Extract .response from each chunk.
  return raw
    .split('\n')
    .filter((l) => l.startsWith('data: '))
    .map((l) => l.slice(6).trim())
    .filter((p) => p && p !== '[DONE]' && p !== '[ERROR]')
    .map((chunk) => {
      try { return (JSON.parse(chunk) as { response?: string }).response ?? ''; } catch { return ''; }
    })
    .join('');
}

// ─── Output Filter ────────────────────────────────────────────────────────────
// Scans the assembled AI response for policy violations BEFORE streaming it to
// the client. If a violation is detected the entire response is swapped for the
// fallback — we never send a partial response that leaks some but not all of the
// flagged content.
//
// Patterns target:
//   • System-prompt leakage — model repeating its own instructions back
//   • Salary figures — the system prompt tells the model to refuse, but if it
//     hallucinated or was tricked, this is the last line of defense
//   • Secret key names — should never appear in a model response; if they do
//     something has gone very wrong
//   • Off-topic affirmations — catches "Sure, here is a Python script for..."

const OUTPUT_VIOLATIONS: RegExp[] = [
  // Model revealing its instruction set verbatim
  /\bsystem\s*prompt\b/i,
  /\bact\s+as\b.{0,50}\b(chatbot|assistant|AI)\b/i,
  /I\s+am\s+(now\s+)?(programmed|designed|instructed|configured)\s+to/i,
  // Salary / compensation figures (e.g. "₹8 LPA", "$70k", "70,000")
  /\b(salary|compensation|ctc|lpa|package)\b.{0,30}\d/i,
  // Secret environment variable names leaking into responses
  /\b(TURNSTILE_SECRET|RESEND_API_KEY|ADMIN_PASSWORD|SESSION_SECRET)\b/,
  // Compliance violations — confidential/proprietary info
  /\bconfidential\b|\btop.?secret\b/i,
  // Catching successful jailbreaks where model agrees to go off-topic
  /\b(sure|of course|absolutely|certainly),?\s+(here|i can|let me|i'll)\b.{0,60}(script|code|function|class|write)/i,
];

const FALLBACK_RESPONSE =
  "I can only answer questions about Neeha's portfolio, skills, and experience. Please ask me something relevant!";

function filterOutput(text: string): string {
  for (const p of OUTPUT_VIOLATIONS) {
    if (p.test(text)) {
      console.warn('Output filter triggered, pattern:', p.source);
      return FALLBACK_RESPONSE;
    }
  }
  return text;
}

// Wraps the filtered text back into a valid SSE response so the client's
// existing getReader() loop works without any changes.
function makeSseResponse(text: string): Response {
  const body = `data: ${JSON.stringify({ response: text })}\n\ndata: [DONE]\n\n`;
  return new Response(body, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    },
  });
}

// ─── Route handler ────────────────────────────────────────────────────────────

export const POST: APIRoute = async ({ request }) => {
  // Block IPs that have sent more than 6 chat messages in the past hour
  const limiter = await rateLimitByIp(request, 'chat', 6);
  if (!limiter.allowed) {
    return new Response(
      JSON.stringify({ error: 'Rate limit exceeded. Try again later.' }),
      { status: 429, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const body = (await request.json()) as RequestBody;
  const userMessage = String(body?.message ?? '').trim();
  const history = Array.isArray(body?.history) ? body.history : [];

  if (!userMessage) {
    return new Response(JSON.stringify({ error: 'Message is required.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ── Input Guardrail ───────────────────────────────────────────────────────
  // Run BEFORE building the messages array and calling the AI binding.
  // A detected injection returns 400 immediately — the model is never invoked.
  if (isPromptInjection(userMessage)) {
    console.warn('Prompt injection attempt blocked:', userMessage.slice(0, 120));
    return new Response(
      JSON.stringify({ error: "I can only answer questions about Neeha's portfolio. Let's keep things relevant!" }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const ai = (env as any).AI;
  if (!ai) {
    return new Response(JSON.stringify({ error: 'AI binding not configured.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const messages = [
    { role: 'system', content: systemPrompt },
    ...history.slice(-6).map((m: ChatMessage) => ({
      role: m.role,
      content: m.content,
    })),
    { role: 'user', content: userMessage },
  ];

  try {
    const stream = await ai.run(AI_MODEL, {
      messages,
      stream: true,
      max_tokens: 220,
    });

    // ── Output Filter ─────────────────────────────────────────────────────
    // Buffer the full AI response, apply the content filter, then re-emit.
    // This happens entirely server-side — the client never sees the raw output.
    const rawText     = await bufferSseStream(stream);
    const filteredText = filterOutput(rawText);
    return makeSseResponse(filteredText);

  } catch (err) {
    console.error('Workers AI error:', err);
    return new Response(
      JSON.stringify({ error: 'AI service error. Please try again.' }),
      { status: 502, headers: { 'Content-Type': 'application/json' } },
    );
  }
};
