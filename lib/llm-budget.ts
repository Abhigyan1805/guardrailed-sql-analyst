// Global daily cap on LLM calls so a public demo cannot burn the free-tier key.
// In-memory (resets on process restart/UTC day roll), which is the safe
// direction: Render free restarts at most make the cap looser per restart, and
// the provider's own quota remains the hard backstop.
// LLM_DAILY_CAP (default 200); 0 disables the LLM entirely.
let day = '';
let used = 0;

function today() { return new Date().toISOString().slice(0, 10); }
function cap() {
  const n = Number(process.env.LLM_DAILY_CAP ?? 200);
  return Number.isFinite(n) && n >= 0 ? n : 200;
}

/** Reserve one LLM call. Returns false when today's cap is spent. */
export function takeLlmCall(): boolean {
  const d = today();
  if (d !== day) { day = d; used = 0; }
  if (used >= cap()) return false;
  used += 1;
  return true;
}

export function llmBudget() { return { day: today(), used: day === today() ? used : 0, cap: cap() }; }
export function resetLlmBudget() { day = ''; used = 0; }

/** True when the model is configured but today's cap is spent (offline fallback in effect). */
export function llmCapReached() { const b = llmBudget(); return b.used >= b.cap; }
