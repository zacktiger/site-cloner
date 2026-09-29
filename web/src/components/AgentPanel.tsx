import { useState, type FormEvent } from "react";
import { api, type SiteMeta, type Stage } from "../api";

const STEPS: { label: string; stages: Stage[] }[] = [
  { label: "Capture the page", stages: ["capture"] },
  { label: "Analyze layout and design", stages: ["analyze"] },
  { label: "Generate React components", stages: ["generate"] },
  { label: "Validate and fix errors", stages: ["validate", "fix"] },
  { label: "Compare with the original", stages: ["review"] },
];
const ORDER: Stage[] = ["capture", "analyze", "generate", "validate", "fix", "review", "done"];

const EXAMPLES = [
  "Change the primary color to blue",
  "Make the navbar sticky",
  "Add a testimonials section",
  "Replace the hero section with a bakery hero",
];

// A step is done, active, failed or pending, depending on the stage the agent is at.
function stepState(site: SiteMeta, stages: Stage[]) {
  if (site.changes.length > 0 || site.stage === "done") return "done";
  if (stages.includes(site.stage)) return site.status === "failed" ? "failed" : "active";
  return ORDER.indexOf(site.stage) > ORDER.indexOf(stages[0]) ? "done" : "pending";
}

export default function AgentPanel({
  site,
  onUpdate,
  onDelete,
}: {
  site: SiteMeta;
  onUpdate: (meta: SiteMeta) => void;
  onDelete: () => void;
}) {
  const [instruction, setInstruction] = useState("");
  const [error, setError] = useState("");

  const running = site.status === "running";
  const canModify = !!site.analysis && !running;
  const canUndo = !running && site.changes.some((c) => c.status === "applied");
  const cost = site.usage.reduce((sum, c) => sum + c.costUsd, 0);
  const tokensIn = site.usage.reduce((sum, c) => sum + c.inputTokens, 0);
  const tokensOut = site.usage.reduce((sum, c) => sum + c.outputTokens, 0);

  const act = async (action: () => Promise<SiteMeta>) => {
    setError("");
    try {
      onUpdate(await action());
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!instruction.trim()) return;
    act(() => api.modify(site.id, instruction.trim())).then(() => setInstruction(""));
  };

  return (
    <div className="agent">
      <section className="card">
        <header className="card-head">
          <h2>Agent</h2>
          <span className={`status status-${site.status}`}>{running ? (site.stage === "modify" ? "Editing" : "Working") : site.status === "ready" ? "Ready" : "Failed"}</span>
        </header>
        <div className="source-row">
          <a className="source-url" href={site.url} target="_blank" rel="noreferrer">{site.url}</a>
          <button
            className="ghost small"
            disabled={running}
            onClick={() => api.remove(site.id).then(onDelete, (err: Error) => setError(err.message))}
          >
            Delete
          </button>
        </div>
        <ol className="steps">
          {STEPS.map((step) => (
            <li key={step.label} className={`step step-${stepState(site, step.stages)}`}>
              {step.label}
              {step.stages.includes("fix") && site.stage === "fix" && <span className="step-note">fixing</span>}
            </li>
          ))}
        </ol>
        {site.error && <p className="alert">{site.error}</p>}
        {site.validationErrors.length > 0 && !running && (
          <details className="errors">
            <summary>{site.validationErrors.length} validation error(s) left</summary>
            <pre>{site.validationErrors.join("\n\n")}</pre>
          </details>
        )}
      </section>

      <section className="card">
        <header className="card-head">
          <h2>Modify with a prompt</h2>
          <button className="ghost small" disabled={!canUndo} onClick={() => act(() => api.undo(site.id))}>
            Undo last change
          </button>
        </header>

        {site.changes.length > 0 && (
          <ul className="changes">
            {site.changes.map((c, i) => (
              <li key={i} className={`change change-${c.status}`}>
                <p className="change-instruction">{c.instruction}</p>
                <p className="change-result">
                  {c.status === "running" ? "Working on it…" : c.status === "undone" ? `Undone. ${c.summary ?? ""}` : c.summary}
                </p>
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={submit} className="modify">
          <textarea
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) submit(e);
            }}
            placeholder={canModify ? "Describe a change, e.g. make the navbar sticky" : "Available once the clone is ready"}
            disabled={!canModify}
            rows={3}
          />
          <div className="examples">
            {EXAMPLES.map((ex) => (
              <button type="button" key={ex} className="chip" disabled={!canModify} onClick={() => setInstruction(ex)}>
                {ex}
              </button>
            ))}
          </div>
          <button type="submit" disabled={!canModify || !instruction.trim()}>
            Apply change
          </button>
          {error && <p className="alert">{error}</p>}
        </form>
      </section>

      <section className="card">
        <header className="card-head">
          <h2>Cost</h2>
          <strong className="cost">${cost.toFixed(4)}</strong>
        </header>
        <p className="muted">
          {site.usage.length} model calls, {(tokensIn / 1000).toFixed(1)}k tokens in, {(tokensOut / 1000).toFixed(1)}k out
        </p>
        {site.usage.length > 0 && (
          <table className="usage">
            <thead>
              <tr>
                <th>Step / model</th>
                <th>In</th>
                <th>Out</th>
                <th>Time</th>
                <th>Cost</th>
              </tr>
            </thead>
            <tbody>
              {site.usage.map((u, i) => (
                <tr key={i}>
                  <td>
                    {u.step}
                    <small className="usage-model">{u.model.replace("gemini-", "")}</small>
                  </td>
                  <td>{(u.inputTokens / 1000).toFixed(1)}k</td>
                  <td>{(u.outputTokens / 1000).toFixed(1)}k</td>
                  <td>{u.seconds}s</td>
                  <td>${u.costUsd.toFixed(4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card">
        <details open={running}>
          <summary className="card-head">
            <h2>Log</h2>
          </summary>
          <ol className="log">
            {site.log.map((entry, i) => (
              <li key={i}>
                <time>{new Date(entry.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time>
                <span>{entry.message}</span>
              </li>
            ))}
          </ol>
        </details>
      </section>
    </div>
  );
}
