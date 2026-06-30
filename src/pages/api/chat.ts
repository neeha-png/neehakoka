// chat.ts — "Ask My Résumé" AI chatbot endpoint.
// Accepts a POST with { message, history[] } and streams the reply via SSE.
// Uses Cloudflare Workers AI (llama-3.1-8b-instruct) via the env.AI binding.
// The SSE stream emits { response: "..." } chunks terminated by [DONE].

import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { rateLimitByIp } from '../../lib/rateLimit';
import { cvMarkdown } from '../../data/cv';

// Shape of each turn in the conversation history sent from the frontend
type ChatMessage = { role: 'user' | 'assistant'; content: string };
type RequestBody = { message: string; history?: ChatMessage[] };

// Workers AI model — Llama 3.1 8B runs on Cloudflare's GPU infrastructure
// without needing an external API key or incurring per-token costs
const AI_MODEL = '@cf/meta/llama-3.1-8b-instruct';

// System prompt that grounds the model strictly to CV content.
// The salary refusal and out-of-scope refusal lines are explicit guardrails
// tested by the eval suite in scripts/run-evals.ts.
const systemPrompt = [
  'Act as an "Ask my Résumé" chatbot.',
  'Ground ALL answers strictly in the provided CV data below.',
  'If asked about salary, decline gracefully: "I cannot discuss specific salary requirements here, please reach out directly via email".',
  'If asked an out-of-scope question (e.g., "Write a Python script", "What is the capital of France?"), refuse politely.',
  'Keep answers concise (2-3 sentences max).',
  '\n---\nCV DATA:\n' + cvMarkdown,
].join('\n');

export const POST: APIRoute = async ({ request }) => {
  // Block IPs that have sent more than 6 chat messages in the past hour
  const limiter = await rateLimitByIp(request, 'chat', 6);
  if (!limiter.allowed) {
    return new Response(
      JSON.stringify({ error: 'Rate limit exceeded. Try again later.' }),
      { status: 429, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // Parse the incoming JSON body and extract the user's message and conversation history
  const body = (await request.json()) as RequestBody;
  const userMessage = String(body?.message ?? '').trim();
  const history = Array.isArray(body?.history) ? body.history : [];

  // Reject empty messages before hitting the AI binding
  if (!userMessage) {
    return new Response(JSON.stringify({ error: 'Message is required.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Ensure the Workers AI binding is available (configured in wrangler.jsonc under "ai")
  const ai = (env as any).AI;
  if (!ai) {
    return new Response(JSON.stringify({ error: 'AI binding not configured.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Build the messages array: system prompt + last 6 history turns + current message.
  // Workers AI uses OpenAI-compatible role names (system / user / assistant).
  const messages = [
    { role: 'system', content: systemPrompt },
    ...history.slice(-6).map((m: ChatMessage) => ({
      role: m.role,
      content: m.content,
    })),
    { role: 'user', content: userMessage },
  ];

  try {
    // Run the model with stream: true — returns a ReadableStream of SSE events.
    // Each event has the shape: data: {"response":"..."}\n\n
    // The stream ends with: data: [DONE]\n\n
    const stream = await ai.run(AI_MODEL, {
      messages,
      stream: true,
      max_tokens: 220,
    });

    // Pipe the raw SSE stream directly to the browser.
    // X-Accel-Buffering: no prevents Nginx proxies from buffering the stream.
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (err) {
    console.error('Workers AI error:', err);
    return new Response(
      JSON.stringify({ error: 'AI service error. Please try again.' }),
      { status: 502, headers: { 'Content-Type': 'application/json' } },
    );
  }
};
