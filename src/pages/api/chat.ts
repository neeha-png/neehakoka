import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { rateLimitByIp } from '../../lib/rateLimit';
import { cvMarkdown } from '../../data/cv';

type ChatMessage = { role: 'user' | 'assistant'; content: string };
type RequestBody = { message: string; history?: ChatMessage[] };

const GEMINI_MODEL = 'gemini-2.5-flash-lite';

const systemPrompt = [
  'Act as an "Ask my Résumé" chatbot.',
  'Ground ALL answers strictly in the provided CV data below.',
  'If asked about salary, decline gracefully: "I cannot discuss specific salary requirements here, please reach out directly via email".',
  'If asked an out-of-scope question (e.g., "Write a Python script", "What is the capital of France?"), refuse politely.',
  'Keep answers concise (2-3 sentences max).',
  '\n---\nCV DATA:\n' + cvMarkdown,
].join('\n');

export const POST: APIRoute = async ({ request }) => {
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

  const geminiApiKey = (env as any).GEMINI_API_KEY as string | undefined;
  if (!geminiApiKey) {
    return new Response(JSON.stringify({ error: 'Missing GEMINI_API_KEY.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Build Gemini contents array (role must be "user" or "model")
  const contents = [
    ...history.slice(-6).map((m: ChatMessage) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    })),
    { role: 'user', parts: [{ text: userMessage }] },
  ];

  const geminiRes = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${geminiApiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents,
        generationConfig: { maxOutputTokens: 220, temperature: 0.4 },
      }),
    },
  );

  if (!geminiRes.ok) {
    console.error('Gemini API error:', geminiRes.status, await geminiRes.text());
    return new Response(
      JSON.stringify({ error: 'AI service error. Please try again.' }),
      { status: 502, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const data = await geminiRes.json() as any;
  const reply =
    (data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '').trim() ||
    "Sorry, I didn't get a response.";

  return new Response(JSON.stringify({ reply }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
