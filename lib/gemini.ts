// Minimal Gemini REST client shared by the app (lib/agent.ts) and the eval
// harness (eval/engines/gemini.ts) so both exercise the same provider code.
// The API key is sent in a header, never in the URL, so it cannot leak into
// request logs or error messages.

export class QuotaExhausted extends Error {
  constructor(model: string) { super(`Gemini free-tier quota exhausted on ${model}`); this.name = 'QuotaExhausted'; }
}

export interface GeminiRequest {
  prompt: string;
  model: string;
  apiKey: string;
  system?: string;
  maxOutputTokens?: number;
  timeoutMs?: number;
}

export interface GeminiResponse {
  text: string;
  tokensIn: number;
  tokensOut: number;
}

export async function geminiGenerate(req: GeminiRequest): Promise<GeminiResponse> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), req.timeoutMs ?? 45000);
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${req.model}:generateContent`,
      {
        method: 'POST',
        signal: ctrl.signal,
        headers: { 'content-type': 'application/json', 'x-goog-api-key': req.apiKey },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: req.system ?? 'You are a Postgres analyst. Return JSON only.' }] },
          contents: [{ parts: [{ text: req.prompt }] }],
          generationConfig: {
            response_mime_type: 'application/json', maxOutputTokens: req.maxOutputTokens ?? 2048, temperature: 0,
            // No reasoning needed for single-SQL generation; thinking tokens
            // otherwise eat the output budget and truncate hard queries.
            thinkingConfig: { thinkingBudget: 0 },
          },
        }),
      },
    );
    if (res.status === 429) throw new QuotaExhausted(req.model);
    if (!res.ok) throw new Error(`gemini ${req.model} HTTP ${res.status}`);
    const data = await res.json();
    const parts = data.candidates?.[0]?.content?.parts ?? [];
    const text = parts.find((p: any) => typeof p?.text === 'string')?.text;
    if (!text) {
      if (data.candidates?.[0]?.finishReason === 'MAX_TOKENS') throw new Error('gemini truncated (MAX_TOKENS)');
      throw new Error(`gemini ${req.model} empty response`);
    }
    const usage = data.usageMetadata ?? {};
    return { text, tokensIn: usage.promptTokenCount ?? 0, tokensOut: usage.candidatesTokenCount ?? 0 };
  } finally {
    clearTimeout(t);
  }
}
