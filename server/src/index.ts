import express from "express";
import { DATA_DIR, GEMINI_API_KEY, GEMINI_MODEL, PORT, PREVIEW_URL } from "./config.js";
import { readSourceFiles, restore } from "./agent/files.js";
import { runClone, runModify, undoLastChange } from "./agent/pipeline.js";
import { createMeta, listMetas, readMeta, updateMeta } from "./store.js";

// HTTP API used by the web UI. Long jobs (clone, modify) run in the background;
// the UI polls GET /api/sites/:id to follow their progress.

const app = express();
app.use(express.json());
app.use("/data", express.static(DATA_DIR)); // screenshots of the original sites

app.get("/api/config", (_req, res) => {
  res.json({ previewUrl: PREVIEW_URL, model: GEMINI_MODEL, hasApiKey: Boolean(GEMINI_API_KEY) });
});

app.get("/api/sites", (_req, res) => {
  res.json(listMetas().map(({ id, url, status, createdAt }) => ({ id, url, status, createdAt })));
});

app.post("/api/sites", (req, res) => {
  const url = normalizeUrl(String(req.body?.url ?? ""));
  if (!url) return res.status(400).json({ error: "Please enter a valid http(s) website URL" });
  if (!GEMINI_API_KEY) return res.status(500).json({ error: "GEMINI_API_KEY is missing in .env" });

  const host = new URL(url).hostname.replace(/^www\./, "");
  const id = `${host.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${Math.random().toString(36).slice(2, 6)}`;
  const meta = createMeta(id, url);
  void runClone(id, url); // runs in the background
  res.status(202).json(meta);
});

app.get("/api/sites/:id", (req, res) => {
  const meta = readMeta(req.params.id);
  if (!meta) return res.status(404).json({ error: "Site not found" });
  res.json(meta);
});

app.get("/api/sites/:id/files", (req, res) => {
  if (!readMeta(req.params.id)) return res.status(404).json({ error: "Site not found" });
  res.json(readSourceFiles(req.params.id));
});

app.post("/api/sites/:id/modify", (req, res) => {
  const meta = readMeta(req.params.id);
  const instruction = String(req.body?.instruction ?? "").trim();
  if (!meta) return res.status(404).json({ error: "Site not found" });
  if (meta.status === "running") return res.status(409).json({ error: "The agent is still working on this site" });
  if (!meta.analysis) return res.status(409).json({ error: "This site was never generated, so it cannot be modified" });
  if (!instruction) return res.status(400).json({ error: "Please describe the change" });

  void runModify(meta.id, instruction.slice(0, 2000));
  res.status(202).json(readMeta(meta.id));
});

app.post("/api/sites/:id/undo", (req, res) => {
  const meta = readMeta(req.params.id);
  if (!meta) return res.status(404).json({ error: "Site not found" });
  if (meta.status === "running") return res.status(409).json({ error: "The agent is still working on this site" });
  try {
    undoLastChange(meta.id);
    res.json(readMeta(meta.id));
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});

function normalizeUrl(input: string): string | null {
  const withScheme = /^https?:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`;
  try {
    const url = new URL(withScheme);
    return url.hostname.includes(".") ? url.toString() : null;
  } catch {
    return null;
  }
}

// A job cannot survive a server restart; mark anything left "running" as interrupted.
for (const meta of listMetas().filter((m) => m.status === "running")) {
  const lastChange = meta.changes[meta.changes.length - 1];
  if (lastChange?.status === "running" && lastChange.version) restore(meta.id, lastChange.version);
  updateMeta(meta.id, (m) => {
    m.status = m.analysis ? "ready" : "failed";
    if (m.analysis) m.stage = "done";
    m.error = "Interrupted because the server restarted";
    const last = m.changes[m.changes.length - 1];
    if (last?.status === "running") last.status = "failed";
  });
}

app.listen(PORT, () => {
  console.log(`Agent server on http://localhost:${PORT} (model: ${GEMINI_MODEL})`);
  if (!GEMINI_API_KEY) console.warn("GEMINI_API_KEY is not set. Copy .env.example to .env and add your key.");
});
