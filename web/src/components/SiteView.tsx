import { useState } from "react";
import type { SiteMeta } from "../api";
import AnalysisView from "./AnalysisView";
import CodeView from "./CodeView";

type Tab = "preview" | "compare" | "analysis" | "code";
type Device = "desktop" | "tablet" | "mobile";

const WIDTHS: Record<Device, string> = { desktop: "100%", tablet: "768px", mobile: "390px" };
const TABS: { id: Tab; label: string }[] = [
  { id: "preview", label: "Preview" },
  { id: "compare", label: "Compare with original" },
  { id: "analysis", label: "Analysis" },
  { id: "code", label: "Code" },
];

export default function SiteView({ site, previewUrl }: { site: SiteMeta; previewUrl: string }) {
  const [tab, setTab] = useState<Tab>("preview");
  const [device, setDevice] = useState<Device>("desktop");
  const [reloads, setReloads] = useState(0);

  const src = `${previewUrl}/${site.id}/`;
  const hasCode = ["validate", "fix", "review", "done", "modify"].includes(site.stage) && !!site.analysis;
  // Remount the iframe whenever a job finishes, so the preview always shows the latest code.
  const frameKey = `${site.status}-${site.changes.map((c) => c.status).join()}-${reloads}`;

  const frame = (
    <div className="device" style={{ width: WIDTHS[device] }}>
      <iframe key={frameKey} src={src} title="Generated site preview" />
    </div>
  );

  return (
    <div className="siteview">
      <div className="toolbar">
        <div className="tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? "active" : ""} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
        {(tab === "preview" || tab === "compare") && (
          <div className="toolbar-right">
            <div className="segmented" role="group" aria-label="Screen size">
              {(Object.keys(WIDTHS) as Device[]).map((d) => (
                <button key={d} aria-pressed={device === d} className={device === d ? "active" : ""} onClick={() => setDevice(d)}>
                  {d[0].toUpperCase() + d.slice(1)}
                </button>
              ))}
            </div>
            <button className="ghost" onClick={() => setReloads((r) => r + 1)}>Reload</button>
            <a className="ghost" href={src} target="_blank" rel="noreferrer">Open in new tab</a>
          </div>
        )}
      </div>

      <div className="canvas">
        {tab === "analysis" ? (
          <AnalysisView site={site} />
        ) : tab === "code" ? (
          hasCode ? <CodeView siteId={site.id} version={frameKey} /> : <Waiting site={site} />
        ) : !hasCode ? (
          <Waiting site={site} />
        ) : tab === "preview" ? (
          frame
        ) : (
          <div className="compare">
            <figure>
              <figcaption>Original ({new URL(site.url).hostname})</figcaption>
              <div className="shot" style={{ width: device === "desktop" ? "100%" : WIDTHS.mobile }}>
                <img src={`/data/${site.id}/${device === "desktop" ? "original.jpg" : "original-mobile.jpg"}`} alt="Screenshot of the original website" />
              </div>
            </figure>
            <figure>
              <figcaption>Generated clone</figcaption>
              {frame}
            </figure>
          </div>
        )}
      </div>
    </div>
  );
}

function Waiting({ site }: { site: SiteMeta }) {
  if (site.status === "failed") {
    return (
      <div className="waiting failed">
        <h2>The clone failed</h2>
        <p>{site.error}</p>
        <p>Check the agent log on the right for the step that failed, then try again or try another URL.</p>
      </div>
    );
  }
  return (
    <div className="waiting">
      <div className="spinner" aria-hidden />
      <p>The preview appears once the components are written.</p>
    </div>
  );
}
