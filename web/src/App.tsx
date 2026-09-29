import { useCallback, useEffect, useState } from "react";
import { api, type Config, type SiteMeta, type SiteSummary } from "./api";
import UrlBar from "./components/UrlBar";
import Sidebar from "./components/Sidebar";
import SiteView from "./components/SiteView";
import AgentPanel from "./components/AgentPanel";

const idFromHash = () => new URLSearchParams(location.hash.slice(1)).get("site");

// Polls the selected site while the agent is working on it.
function useSite(id: string | null) {
  const [site, setSite] = useState<SiteMeta | null>(null);
  const [wake, setWake] = useState(0); // bumped after an action to restart polling

  useEffect(() => setSite(null), [id]);

  useEffect(() => {
    if (!id) return;
    let stopped = false;
    let timer: number;
    const tick = async () => {
      try {
        const meta = await api.getSite(id);
        if (stopped) return;
        setSite(meta);
        if (meta.status === "running") timer = window.setTimeout(tick, 1500);
      } catch {
        if (!stopped) timer = window.setTimeout(tick, 3000);
      }
    };
    tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [id, wake]);

  const follow = useCallback((meta: SiteMeta) => {
    setSite(meta);
    setWake((w) => w + 1);
  }, []);

  return { site, follow };
}

export default function App() {
  const [config, setConfig] = useState<Config | null>(null);
  const [sites, setSites] = useState<SiteSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(idFromHash());
  const { site, follow } = useSite(selectedId);

  const loadSites = useCallback(() => api.listSites().then(setSites).catch(() => {}), []);

  useEffect(() => {
    api.config().then(setConfig).catch(() => {});
    loadSites();
  }, [loadSites]);

  // Keep the sidebar's status dots in sync with the selected site.
  useEffect(() => {
    if (site) setSites((all) => all.map((s) => (s.id === site.id ? { ...s, status: site.status } : s)));
  }, [site?.id, site?.status]);

  const select = (id: string) => {
    setSelectedId(id);
    location.hash = `site=${id}`;
  };

  const startClone = async (url: string) => {
    const meta = await api.clone(url);
    await loadSites();
    select(meta.id);
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden />
          Site Cloner
        </div>
        <UrlBar onSubmit={startClone} disabledReason={config && !config.hasApiKey ? "Add GEMINI_API_KEY to .env first" : undefined} />
        {config && <div className="model">Model: {config.model}</div>}
      </header>

      <Sidebar sites={sites} selectedId={selectedId} onSelect={select} />

      <main className="stage">
        {site && config ? (
          <SiteView site={site} previewUrl={config.previewUrl} />
        ) : (
          <div className="empty">
            <h1>Rebuild any website as a React app</h1>
            <p>
              Paste a public URL above. The agent captures the page, plans its sections, writes React and Tailwind
              components, checks that they compile and render, and shows you a live preview. Then describe changes in
              plain English.
            </p>
          </div>
        )}
      </main>

      <aside className="panel">
        {site && (
          <AgentPanel
            site={site}
            onUpdate={follow}
            onDelete={() => {
              setSelectedId(null);
              history.replaceState(null, "", location.pathname);
              loadSites();
            }}
          />
        )}
      </aside>
    </div>
  );
}
