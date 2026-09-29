import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./config.js";
import type { SiteSpec } from "./agent/analyze.js";

// Everything about one cloned site is kept in data/<id>/meta.json.
// No database: the file system is enough for a local, single-user tool.

// The step the agent is on. When a job fails, the stage stays where it failed.
export type Stage = "capture" | "analyze" | "generate" | "validate" | "fix" | "modify" | "done";

export interface LlmCall {
  step: string;
  model: string;
  inputTokens: number;
  outputTokens: number; // includes thinking tokens, since they are billed as output
  cachedTokens: number;
  costUsd: number;
  seconds: number;
}

export interface Change {
  instruction: string;
  time: string;
  status: "running" | "applied" | "failed" | "undone";
  summary?: string;
  version?: number; // snapshot to restore when this change is undone
}

export interface SiteMeta {
  id: string;
  url: string;
  createdAt: string;
  status: "running" | "ready" | "failed";
  stage: Stage;
  error?: string;
  log: { time: string; message: string }[];
  analysis?: SiteSpec;
  validationErrors: string[]; // errors left after the last validation, if any
  usage: LlmCall[];
  changes: Change[];
  versions: number; // number of snapshots taken so far
}

export const siteDataDir = (id: string) => path.join(DATA_DIR, id);
const metaPath = (id: string) => path.join(siteDataDir(id), "meta.json");

export function readMeta(id: string): SiteMeta | null {
  try {
    return JSON.parse(fs.readFileSync(metaPath(id), "utf8"));
  } catch {
    return null;
  }
}

export function writeMeta(meta: SiteMeta) {
  fs.mkdirSync(siteDataDir(meta.id), { recursive: true });
  fs.writeFileSync(metaPath(meta.id), JSON.stringify(meta, null, 2));
}

export function updateMeta(id: string, change: (meta: SiteMeta) => void): SiteMeta {
  const meta = readMeta(id);
  if (!meta) throw new Error(`Unknown site ${id}`);
  change(meta);
  writeMeta(meta);
  return meta;
}

export function listMetas(): SiteMeta[] {
  if (!fs.existsSync(DATA_DIR)) return [];
  return fs
    .readdirSync(DATA_DIR)
    .map(readMeta)
    .filter((m): m is SiteMeta => m !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function createMeta(id: string, url: string): SiteMeta {
  const meta: SiteMeta = {
    id,
    url,
    createdAt: new Date().toISOString(),
    status: "running",
    stage: "capture",
    log: [],
    validationErrors: [],
    usage: [],
    changes: [],
    versions: 0,
  };
  writeMeta(meta);
  return meta;
}

// A Job is the handle each agent step uses to report progress and token usage.
export interface Job {
  id: string;
  log(message: string): void;
  stage(stage: Stage): void;
  recordUsage(call: LlmCall): void;
}

export function createJob(id: string): Job {
  return {
    id,
    log(message) {
      console.log(`[${id}] ${message}`);
      updateMeta(id, (m) => m.log.push({ time: new Date().toISOString(), message }));
    },
    stage(stage) {
      updateMeta(id, (m) => (m.stage = stage));
    },
    recordUsage(call) {
      updateMeta(id, (m) => m.usage.push(call));
    },
  };
}
