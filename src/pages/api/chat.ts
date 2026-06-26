import { env } from 'cloudflare:workers';
import { rateLimitByIp } from '../../lib/rateLimit';
import { getProfileContext } from '../../lib/profileContext';

type ChatMessage = { role: 'user' | 'assistant'; content: string };

type RequestBody = {
  message: string;
  history?: ChatMessage[];
};

export async function POST({ request }: { request: Request }) {
  const limiter = await rateLimitByIp(request, 'chat', 6);
  if (!limiter.allowed) {
    return new Response(
      JSON.stringify({ error: 'Rate limit exceeded. Try again later.' }),
      { status: 429, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // Secrets Store binding: access via .get() on the binding object, or plain string fallback
  const geminiBinding = (env as any).GEMINI_API_KEY;
  const apiKey: string | null = typeof geminiBinding?.get === 'function'
    ? await geminiBinding.get()
    : (typeof geminiBinding === 'string' ? geminiBinding : null);

  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: 'Missing GEMINI_API_KEY environment variable.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
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

  const profileContext = getProfileContext();

  const trimmedHistory = history.slice(-10);
  const chatTranscript = [
    ...trimmedHistory,
    { role: 'user' as const, content: userMessage },
  ];

  const promptText = [
    profileContext,
    "\n---\nConversation:",
    ...chatTranscript.map((m) => `${m.role.toUpperCase()}: ${m.content}`),
    "\nASSISTANT:",
  ].join("\n");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(apiKey)}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [{ text: promptText }],
        },
      ],
      generationConfig: {
        temperature: 0.4,
        maxOutputTokens: 700,
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return new Response(
      JSON.stringify({ error: 'Gemini request failed.', details: text || undefined }),
      { status: 502, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const data = await res.json() as {
    candidates?: Array<{
      content?: {
        parts?: Array<{ text?: string }>;
      };
    }>;
  };

  const reply =
    data?.candidates?.[0]?.content?.parts
      ?.map((p) => p?.text)
      .filter(Boolean)
      .join('') || 'Sorry, could not generate a reply right now.';

  return new Response(JSON.stringify({ reply }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}