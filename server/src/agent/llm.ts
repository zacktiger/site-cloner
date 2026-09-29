import { ApiError, GoogleGenAI, ThinkingLevel, type GenerateContentResponseUsageMetadata, type Part } from "@google/genai";
import { GEMINI_API_KEY, GEMINI_FALLBACK_MODELS, GEMINI_MODEL, PRICES } from "../config.js";
import type { Job } from "../store.js";

// The only file that talks to Gemini. Every call goes through here so that
// retries, model fallback, token accounting and cost tracking live in one place.

let client: GoogleGenAI | null = null;

function getClient() {
  if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not set. Add it to the .env file in the project root.");
  client ??= new GoogleGenAI({ apiKey: GEMINI_API_KEY });
  return client;
}

export { ThinkingLevel };

export interface LlmRequest {
  step: string; // label shown in the cost breakdown, e.g. "analyze"
  system: string;
  parts: Part[]; // user message: text and images
  jsonSchema?: object; // when set, the model must answer with JSON matching this schema
  thinking?: ThinkingLevel;
  maxOutputTokens?: number;
}

export const textPart = (text: string): Part => ({ text });
export const imagePart = (jpeg: Buffer): Part => ({
  inlineData: { mimeType: "image/jpeg", data: jpeg.toString("base64") },
});

const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const ATTEMPTS_PER_MODEL = 3;
const COOLDOWN_MS = 5 * 60_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// A model that just failed with "overloaded" is skipped for a few minutes, so later
// calls go straight to a working model instead of waiting through the retries again.
const overloadedUntil = new Map<string, number>();

// Overloaded / rate limited / server errors, and dropped connections, are worth retrying.
// Anything else (bad request, invalid key) will fail the same way again.
function retryReason(err: unknown): string | null {
  if (err instanceof ApiError) return RETRYABLE.has(err.status) ? `HTTP ${err.status}` : null;
  if (err instanceof Error && /fetch failed|ECONNRESET|ETIMEDOUT|socket|network/i.test(err.message)) return "network error";
  return null;
}

// Gemini errors carry a JSON body (sometimes JSON inside JSON); turn it into one readable sentence.
function describeError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  let message = err.message;
  let status = "";
  for (let depth = 0; depth < 3; depth++) {
    try {
      const body = JSON.parse(message);
      status = body.error?.status ?? status;
      message = body.error?.message ?? message;
    } catch {
      break;
    }
  }
  const firstLine = message.split("\n")[0].slice(0, 300);
  if (status === "RESOURCE_EXHAUSTED") return `Gemini quota exceeded: ${firstLine}`;
  if (status === "UNAVAILABLE") return `Gemini is overloaded right now: ${firstLine}`;
  return `Gemini error: ${firstLine}`;
}

export async function callModel(job: Job, req: LlmRequest): Promise<string> {
  // If the main model stays overloaded (503/429), try the fallback models instead of failing.
  const chain = [...new Set([GEMINI_MODEL, ...GEMINI_FALLBACK_MODELS])];
  const available = chain.filter((m) => (overloadedUntil.get(m) ?? 0) < Date.now());
  const models = available.length ? available : chain;
  let lastError: unknown;

  for (const model of models) {
    for (let attempt = 1; attempt <= ATTEMPTS_PER_MODEL; attempt++) {
      try {
        return await callOnce(job, req, model);
      } catch (err) {
        lastError = err;
        const reason = retryReason(err);
        if (!reason) throw new Error(describeError(err));
        // Out of quota (429): waiting a few seconds will not help, go to the next model now.
        if (err instanceof ApiError && err.status === 429) break;
        if (attempt < ATTEMPTS_PER_MODEL) {
          const wait = 3000 * 2 ** (attempt - 1); // 3s, 6s
          job.log(`${model} failed (${reason}), retrying in ${wait / 1000}s`);
          await sleep(wait);
        }
      }
    }
    overloadedUntil.set(model, Date.now() + COOLDOWN_MS);
    const next = models[models.indexOf(model) + 1];
    if (next) job.log(`${model} is unavailable (${describeError(lastError).slice(0, 80)}), switching to ${next}`);
  }
  throw new Error(describeError(lastError));
}

// Gemini 3 models take a thinking level; Gemini 2.5 models take a token budget instead.
function thinkingFor(model: string, level: ThinkingLevel) {
  if (!model.startsWith("gemini-2.")) return { thinkingLevel: level };
  return { thinkingBudget: level === ThinkingLevel.MEDIUM ? 4096 : level === ThinkingLevel.HIGH ? 16384 : 1024 };
}

// Streams the answer: the connection stays active while the model writes, so a long
// generation does not hit the HTTP client's "no response for 5 minutes" timeout.
async function callOnce(job: Job, req: LlmRequest, model: string): Promise<string> {
  const started = Date.now();
  const stream = await getClient().models.generateContentStream({
    model,
    contents: [{ role: "user", parts: req.parts }],
    config: {
      systemInstruction: req.system,
      thinkingConfig: thinkingFor(model, req.thinking ?? ThinkingLevel.LOW),
      maxOutputTokens: req.maxOutputTokens ?? 32768,
      ...(req.jsonSchema && { responseMimeType: "application/json", responseJsonSchema: req.jsonSchema }),
    },
  });

  let text = "";
  let usage: GenerateContentResponseUsageMetadata = {};
  let finish: string | undefined;
  for await (const chunk of stream) {
    text += chunk.text ?? "";
    usage = chunk.usageMetadata ?? usage;
    finish = chunk.candidates?.[0]?.finishReason ?? finish;
  }

  const inputTokens = usage.promptTokenCount ?? 0;
  const outputTokens = (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0);
  const price = PRICES[model] ?? { input: 0, output: 0 };
  job.recordUsage({
    step: req.step,
    model,
    inputTokens,
    outputTokens,
    cachedTokens: usage.cachedContentTokenCount ?? 0,
    costUsd: (inputTokens * price.input + outputTokens * price.output) / 1_000_000,
    seconds: Math.round((Date.now() - started) / 1000),
  });

  if (finish === "MAX_TOKENS") job.log(`Warning: ${req.step} hit the output token limit, the answer may be cut off`);
  if (!text) throw new Error(`Model returned no text (finish reason: ${finish ?? "unknown"})`);
  return text;
}
