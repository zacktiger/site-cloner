import { useState, type FormEvent } from "react";

export default function UrlBar({ onSubmit, disabledReason }: { onSubmit: (url: string) => Promise<void>; disabledReason?: string }) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;
    setBusy(true);
    setError("");
    try {
      await onSubmit(url.trim());
      setUrl("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="urlbar" onSubmit={submit}>
      <div className="urlbar-field">
        <span className="urlbar-lock" aria-hidden>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
            <rect x="5" y="11" width="14" height="10" rx="2" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" />
          </svg>
        </span>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com"
          aria-label="Website URL"
          spellCheck={false}
        />
      </div>
      <button type="submit" disabled={busy || !!disabledReason} title={disabledReason}>
        {busy ? "Starting…" : "Clone site"}
      </button>
      {(error || disabledReason) && <p className="urlbar-error">{error || disabledReason}</p>}
    </form>
  );
}
