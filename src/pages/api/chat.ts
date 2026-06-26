import { rateLimitByIp } from '../../lib/rateLimit';
import { cvMarkdown } from '../../data/cv';

type ChatMessage = { role: 'user' | 'assistant'; content: string };

type RequestBody = {
  message: string;
  history?: ChatMessage[];
};

const encoder = new TextEncoder();

function toSSEStreamFromTextGenerator(textStream: ReadableStream) {
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = textStream.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!value) continue;

          // Workers AI returns bytes; normalize to string chunks.
          const chunkText = typeof value === 'string' ? value : new TextDecoder().decode(value);
          const safe = chunkText.replaceAll('\r', '');

          // SSE format: send each chunk as a "data:" line.
          controller.enqueue(encoder.encode(`data: ${safe}\n\n`));
        }

        controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
        controller.close();
      } catch (err) {
        controller.enqueue(encoder.encode(`data: [ERROR]\n\n`));
        controller.close();
      } finally {
        reader.releaseLock();
      }
    },
  });
}

export async function POST({ request, env }: { request: Request; env: any }) {
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

  const trimmedHistory = history.slice(-6);

  const systemRules = [
    `Act as an "Ask my Résumé" chatbot.`,
    `Ground ALL answers strictly in the provided CV data from src/data/cv.ts.`,
    `If asked about salary, decline gracefully: "I cannot discuss specific salary requirements here, please reach out directly via email".`,
    `If asked an out-of-scope question (e.g., "Write a Python script", "What is the capital of France?"), refuse politely.`,
    `Keep answers concise (2-3 sentences max).`,
  ].join('\n');

  const messages = [
    { role: 'system', content: systemRules + '\n\n---\nCV DATA:\n' + cvMarkdown },
    ...trimmedHistory.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: userMessage },
  ];

  const model = '@cf/meta/llama-3-8b-instruct';

  if (!env?.AI?.run) {
    return new Response(
      JSON.stringify({ error: 'Missing Workers AI binding (env.AI).' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const aiResult = await env.AI.run(model, {
    messages,
    stream: true,
    max_tokens: 220,
    temperature: 0.4,
  });

  // aiResult is expected to include a readable stream (Workers AI streaming)
  // Common shapes: { stream } or the stream itself.
  const rawStream: ReadableStream =
    aiResult?.stream instanceof ReadableStream ? aiResult.stream : aiResult;

  const eventStream = toSSEStreamFromTextGenerator(rawStream);

  return new Response(eventStream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
