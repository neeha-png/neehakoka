import { getProfileContext } from '../../lib/profileContext';

type ChatMessage = { role: 'user' | 'assistant'; content: string };

type RequestBody = {
  message: string;
  history?: ChatMessage[];
};

export async function post({ request }: { request: Request }) {
  const apiKey = (import.meta as any).env?.GEMINI_API_KEY;
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

  // Gemini REST: https://ai.google.dev/gemini-api/docs
  // We use the “generateContent” endpoint.
  const profileContext = getProfileContext();

  // Keep conversation small to reduce tokens.
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

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`;

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

  const data = await res.json();
  const reply =
    data?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text).filter(Boolean).join('') ||
    'Sorry—could not generate a reply right now.';

  return new Response(JSON.stringify({ reply }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

