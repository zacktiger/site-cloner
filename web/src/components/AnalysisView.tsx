import type { SiteMeta } from "../api";

export default function AnalysisView({ site }: { site: SiteMeta }) {
  const spec = site.analysis;
  if (!spec) return <div className="waiting"><p>The analysis appears after the page is captured.</p></div>;

  return (
    <div className="analysis">
      <section>
        <h2>{spec.siteName}</h2>
        <p className="lead">{spec.summary}</p>
      </section>

      <section>
        <h3>Colors</h3>
        <ul className="swatches">
          {Object.entries(spec.theme.colors).map(([name, value]) => (
            <li key={name}>
              <span className="swatch" style={{ background: value }} />
              <span>{name}</span>
              <code>{value}</code>
            </li>
          ))}
        </ul>
      </section>

      <section className="two-col">
        <div>
          <h3>Typography</h3>
          <p>Headings: <strong>{spec.theme.headingFont}</strong></p>
          <p>Body: <strong>{spec.theme.bodyFont}</strong></p>
        </div>
        <div>
          <h3>Style</h3>
          <p>{spec.theme.style}</p>
        </div>
      </section>

      <section>
        <h3>Sections, top to bottom</h3>
        <ol className="sections">
          {spec.sections.map((s) => (
            <li key={s.component}>
              <div className="section-head">
                <code>{s.component}</code>
                <span>{s.purpose}</span>
              </div>
              <dl>
                <dt>Layout</dt>
                <dd>{s.layout}</dd>
                <dt>Content</dt>
                <dd>{s.content}</dd>
                <dt>On mobile</dt>
                <dd>{s.mobile}</dd>
              </dl>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
