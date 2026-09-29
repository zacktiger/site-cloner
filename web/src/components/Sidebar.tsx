import type { SiteSummary } from "../api";

const host = (url: string) => new URL(url).hostname.replace(/^www\./, "");

export default function Sidebar({
  sites,
  selectedId,
  onSelect,
}: {
  sites: SiteSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <nav className="sidebar" aria-label="Cloned sites">
      <h2>Clones</h2>
      {sites.length === 0 && <p className="sidebar-empty">Nothing cloned yet.</p>}
      <ul>
        {sites.map((s) => (
          <li key={s.id}>
            <button className={s.id === selectedId ? "active" : ""} onClick={() => onSelect(s.id)}>
              <span className={`dot dot-${s.status}`} aria-label={s.status} />
              <span className="sidebar-host">{host(s.url)}</span>
              <time>{new Date(s.createdAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</time>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
