import fs from "node:fs";
import path from "node:path";
import type { SiteSpec } from "./analyze.js";
import { CSS_HEADER, siteDir } from "./files.js";

// Writes the parts of a generated site that never need AI: index.html, main.tsx,
// tsconfig.json and the theme CSS. Whatever can be deterministic is deterministic,
// so the model only writes components, and fewer things can go wrong.

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const fontStack = (font: string, fallback: string) => `"${cleanFont(font)}", ${fallback}`;

// Sites often use the variable build of a font ("Inter Variable", "Inter VF"). Google Fonts
// only knows the family name, so that suffix is removed ("Playfair Display" stays as it is).
function cleanFont(font: string) {
  const name = (font || "")
    .replace(/["\\;{}]/g, "")
    .replace(/\b(variable|vf)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return name || "Inter";
}

function googleFontsUrl(spec: SiteSpec) {
  const families = [...new Set([spec.theme.headingFont, spec.theme.bodyFont].map(cleanFont))].map(
    (f) => `family=${encodeURIComponent(f).replace(/%20/g, "+")}:wght@300;400;500;600;700;800`,
  );
  return `https://fonts.googleapis.com/css2?${families.join("&")}&display=swap`;
}

// Design tokens become Tailwind theme variables, so components use classes like
// `bg-primary` or `font-heading`. "Change the primary color to blue" is then a
// one-line edit here instead of touching every component.
export function themeCss(spec: SiteSpec) {
  // A malformed color would silently break the CSS, so anything that is not a hex color is replaced.
  const hex = (v: string, fallback: string) => (/^#[0-9a-fA-F]{3,8}$/.test(v?.trim()) ? v.trim() : fallback);
  const t = spec.theme.colors;
  const c = {
    primary: hex(t.primary, "#2563eb"),
    secondary: hex(t.secondary, "#475569"),
    accent: hex(t.accent, "#f59e0b"),
    background: hex(t.background, "#ffffff"),
    surface: hex(t.surface, "#f8fafc"),
    foreground: hex(t.foreground, "#0f172a"),
    muted: hex(t.muted, "#64748b"),
    border: hex(t.border, "#e2e8f0"),
  };
  return `${CSS_HEADER}
@theme {
  --color-primary: ${c.primary};
  --color-secondary: ${c.secondary};
  --color-accent: ${c.accent};
  --color-background: ${c.background};
  --color-surface: ${c.surface};
  --color-foreground: ${c.foreground};
  --color-muted: ${c.muted};
  --color-border: ${c.border};
  --font-heading: ${fontStack(spec.theme.headingFont, "ui-sans-serif, system-ui, sans-serif")};
  --font-body: ${fontStack(spec.theme.bodyFont, "ui-sans-serif, system-ui, sans-serif")};
}

html {
  scroll-behavior: smooth;
}

body {
  margin: 0;
  background: var(--color-background);
  color: var(--color-foreground);
  font-family: var(--font-body);
  -webkit-font-smoothing: antialiased;
}

h1, h2, h3, h4, h5, h6 {
  font-family: var(--font-heading);
}
`;
}

export function scaffoldSite(id: string, spec: SiteSpec) {
  const dir = siteDir(id);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, "src", "components"), { recursive: true });

  fs.writeFileSync(
    path.join(dir, "index.html"),
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(spec.siteName)}</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link rel="stylesheet" href="${escapeHtml(googleFontsUrl(spec))}" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./src/main.tsx"></script>
  </body>
</html>
`,
  );

  fs.writeFileSync(
    path.join(dir, "src", "main.tsx"),
    `import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
`,
  );

  fs.writeFileSync(path.join(dir, "src", "index.css"), themeCss(spec));
  fs.writeFileSync(path.join(dir, "tsconfig.json"), `{ "extends": "../../tsconfig.base.json", "include": ["src"] }\n`);
}
