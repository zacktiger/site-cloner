import fs from "node:fs";
import path from "node:path";
import { SITES_DIR } from "../config.js";
import { siteDataDir } from "../store.js";

// Reading and writing the generated site's source files.
//
// The model returns code as plain-text blocks:
//   <file path="src/components/Hero.tsx">
//   ...code...
//   </file>
//   <delete path="src/components/Pricing.tsx" />
// Plain text instead of JSON, because escaping thousands of lines of JSX inside a
// JSON string is where models make the most mistakes.

export interface SourceFile {
  path: string; // relative to the site folder, e.g. "src/App.tsx"
  content: string;
}

export const siteDir = (id: string) => path.join(SITES_DIR, id);

// main.tsx is part of the fixed scaffold; the model never needs to touch it.
const PROTECTED = new Set(["src/main.tsx"]);
const ALLOWED = /^src\/[A-Za-z0-9_\-/.]+\.(tsx|ts|css)$/;

function isAllowed(filePath: string) {
  return ALLOWED.test(filePath) && !filePath.includes("..") && !PROTECTED.has(filePath);
}

export function parseModelOutput(text: string) {
  const files: SourceFile[] = [];
  for (const m of text.matchAll(/<file path="([^"]+)">\r?\n?([\s\S]*?)<\/file>/g)) {
    const filePath = m[1].trim().replace(/^\.?\//, "");
    // Models sometimes wrap the code in markdown fences inside the tag; strip them.
    const content = m[2].replace(/^\s*```[a-z]*\r?\n/, "").replace(/\r?\n```\s*$/, "").trimEnd() + "\n";
    if (isAllowed(filePath)) files.push({ path: filePath, content });
  }
  const deletes = [...text.matchAll(/<delete path="([^"]+)"\s*\/?>/g)]
    .map((m) => m[1].trim().replace(/^\.?\//, ""))
    .filter(isAllowed);
  const summary = text.match(/<summary>([\s\S]*?)<\/summary>/)?.[1].trim();
  return { files, deletes, summary };
}

export function readSourceFiles(id: string): SourceFile[] {
  const root = siteDir(id);
  const out: SourceFile[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else {
        const rel = path.relative(root, full).split(path.sep).join("/");
        if (isAllowed(rel)) out.push({ path: rel, content: fs.readFileSync(full, "utf8") });
      }
    }
  };
  walk(path.join(root, "src"));
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

// Format files the way the model writes them, so its input and output look alike.
export const formatFiles = (files: SourceFile[]) =>
  files.map((f) => `<file path="${f.path}">\n${f.content}</file>`).join("\n\n");

export function writeSourceFiles(id: string, files: SourceFile[], deletes: string[] = []) {
  const root = siteDir(id);
  for (const file of files) {
    const full = path.join(root, file.path);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, file.path === "src/index.css" ? keepTailwindHeader(file.content) : file.content);
  }
  for (const filePath of deletes) fs.rmSync(path.join(root, filePath), { force: true });
}

// index.css must keep its first lines (Tailwind import + source) or no styles load at all.
export const CSS_HEADER = `@import "tailwindcss" source(none);\n@source "./";\n`;
function keepTailwindHeader(css: string) {
  const body = css
    .replace(/^@import\s+["']tailwindcss["'][^\n]*\n?/m, "")
    .replace(/^@source[^\n]*\n?/m, "")
    .replace(/^@tailwind[^\n]*\n?/gm, ""); // Tailwind v3 syntax, invalid in v4
  return CSS_HEADER + body.replace(/^\s+/, "\n");
}

// Snapshots let a modification be undone, or rolled back if it breaks the build.
const versionDir = (id: string, version: number) => path.join(siteDataDir(id), "versions", String(version));

export function snapshot(id: string, version: number) {
  fs.cpSync(path.join(siteDir(id), "src"), versionDir(id, version), { recursive: true });
}

export function restore(id: string, version: number) {
  const src = path.join(siteDir(id), "src");
  fs.rmSync(src, { recursive: true, force: true });
  fs.cpSync(versionDir(id, version), src, { recursive: true });
}
