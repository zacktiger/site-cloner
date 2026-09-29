// Types mirror server/src/store.ts and server/src/agent/analyze.ts.

export type Stage = "capture" | "analyze" | "generate" | "validate" | "fix" | "review" | "modify" | "done";

export interface LlmCall {
  step: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  costUsd: number;
  seconds: number;
}

export interface Change {
  instruction: string;
  time: string;
  status: "running" | "applied" | "failed" | "undone";
  summary?: string;
}

export interface SiteSpec {
  siteName: string;
  summary: string;
  theme: {
    colors: Record<string, string>;
    headingFont: string;
    bodyFont: string;
    style: string;
  };
  sections: { component: string; purpose: string; layout: string; content: string; mobile: string }[];
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
  validationErrors: string[];
  usage: LlmCall[];
  changes: Change[];
}

export interface SiteSummary {
  id: string;
  url: string;
  status: SiteMeta["status"];
  createdAt: string;
}

export interface Config {
  previewUrl: string;
  model: string;
  hasApiKey: boolean;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { ...init, headers: { "Content-Type": "application/json" } });
  } catch {
    // fetch only throws when the request never got an answer: the agent server is down.
    throw new Error("Can't reach the agent server. Check that `npm run dev` is running, then try again.");
  }
  if (res.status === 502 || res.status === 504) {
    // Vite's proxy answers this way when nothing is listening on port 3001.
    throw new Error("The agent server is not running. Start it with `npm run dev`, then try again.");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Request failed with ${res.status}`);
  return body as T;
}

export const api = {
  config: () => request<Config>("/api/config"),
  listSites: () => request<SiteSummary[]>("/api/sites"),
  getSite: (id: string) => request<SiteMeta>(`/api/sites/${id}`),
  getFiles: (id: string) => request<{ path: string; content: string }[]>(`/api/sites/${id}/files`),
  clone: (url: string) => request<SiteMeta>("/api/sites", { method: "POST", body: JSON.stringify({ url }) }),
  modify: (id: string, instruction: string) =>
    request<SiteMeta>(`/api/sites/${id}/modify`, { method: "POST", body: JSON.stringify({ instruction }) }),
  undo: (id: string) => request<SiteMeta>(`/api/sites/${id}/undo`, { method: "POST" }),
  remove: (id: string) => request<{ ok: boolean }>(`/api/sites/${id}`, { method: "DELETE" }),
};
