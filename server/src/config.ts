import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
dotenv.config({ path: path.join(ROOT, ".env"), quiet: true });

export const PORT = 3001;

// Generated sites live inside the shared preview project so they reuse its node_modules.
export const PREVIEW_DIR = path.join(ROOT, "preview");
export const SITES_DIR = path.join(PREVIEW_DIR, "sites");
export const PREVIEW_URL = "http://localhost:5174";

// Agent state per site: meta.json, screenshots, the DOM capture, and version snapshots.
export const DATA_DIR = path.join(ROOT, "data");

export const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? "";
export const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";
// Tried in order when the main model is overloaded (HTTP 503/429).
export const GEMINI_FALLBACK_MODELS = (process.env.GEMINI_FALLBACK_MODELS || "gemini-3.5-flash,gemini-2.5-flash,gemini-3.5-flash-lite,gemini-3.1-flash-lite")
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean);

// How many times the agent may ask the model to repair build/runtime errors.
export const MAX_FIX_ATTEMPTS = 2;

// USD per 1M tokens (paid tier), from ai.google.dev/gemini-api/docs/pricing, Sept 2026.
// Thinking tokens are billed at the output price.
export const PRICES: Record<string, { input: number; output: number }> = {
  "gemini-3.8-flash": { input: 0.75, output: 3.75 },
  "gemini-3.7-flash": { input: 0.75, output: 3.75 },
  "gemini-3.5-flash": { input: 1.5, output: 9.0 },
  "gemini-3.5-flash-lite": { input: 0.3, output: 2.5 },
  "gemini-3.1-flash-lite": { input: 0.25, output: 1.5 },
  "gemini-3.1-pro-preview": { input: 2.0, output: 12.0 },
  "gemini-2.5-pro": { input: 1.25, output: 10.0 },
  "gemini-2.5-flash": { input: 0.3, output: 2.5 },
};
