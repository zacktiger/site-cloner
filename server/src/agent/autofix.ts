import { createRequire } from "node:module";
import path from "node:path";
import { PREVIEW_DIR } from "../config.js";
import { readSourceFiles, writeSourceFiles, type SourceFile } from "./files.js";

// Fixes the most common generated-code errors without calling the model: missing imports.
// Models often use an icon or one of their own components and forget to import it, or
// use a lucide icon that does not exist (lucide has no brand logos such as GitHub).
// Fixing these in code is instant, free and always correct, so the model is only asked
// about the errors that are left.

// Every name exported by the lucide-react version installed in the preview project.
const LUCIDE = new Set(Object.keys(createRequire(path.join(PREVIEW_DIR, "package.json"))("lucide-react")));
const STAND_IN_ICON = "Globe";

const LUCIDE_IMPORT = /import\s*\{([^}]*)\}\s*from\s*["']lucide-react["'];?/;

function addLucideImports(code: string, names: string[]) {
  const match = code.match(LUCIDE_IMPORT);
  if (!match) return `import { ${names.join(", ")} } from "lucide-react";\n${code}`;
  const existing = match[1].split(",").map((s) => s.trim()).filter(Boolean);
  return code.replace(LUCIDE_IMPORT, `import { ${[...new Set([...existing, ...names])].join(", ")} } from "lucide-react";`);
}

// `import { Github } from "lucide-react"` -> `import { Globe as Github } from "lucide-react"`
function replaceMissingIcons(code: string, names: string[]) {
  return code.replace(LUCIDE_IMPORT, (_, list: string) => {
    const items = list.split(",").map((s) => s.trim()).filter(Boolean);
    const fixed = items.map((item) => (names.includes(item) ? `${STAND_IN_ICON} as ${item}` : item));
    return `import { ${fixed.join(", ")} } from "lucide-react";`;
  });
}

function relativeImport(from: string, to: string) {
  const rel = path.posix.relative(path.posix.dirname(from), to).replace(/\.tsx?$/, "");
  return rel.startsWith(".") ? rel : `./${rel}`;
}

export function autoFixImports(siteId: string, errors: string[]): string[] {
  const files = readSourceFiles(siteId);
  const components = new Map(
    files
      .filter((f) => f.path.endsWith(".tsx") && /export\s+default/.test(f.content))
      .map((f) => [path.posix.basename(f.path, ".tsx"), f.path]),
  );

  // Group the fixable errors by file.
  const missing = new Map<string, Set<string>>(); // file -> names used but not imported
  const badIcons = new Map<string, Set<string>>(); // file -> lucide names that do not exist
  for (const error of errors) {
    let m = error.match(/^(src\/\S+?)\(\d+,\d+\): error TS(?:2304|2552): Cannot find name '(\w+)'/);
    if (m) missing.set(m[1], (missing.get(m[1]) ?? new Set()).add(m[2]));
    m = error.match(/^(src\/\S+?)\(\d+,\d+\): error TS2305: Module '"lucide-react"' has no exported member '(\w+)'/);
    if (m) badIcons.set(m[1], (badIcons.get(m[1]) ?? new Set()).add(m[2]));
  }

  const changed: SourceFile[] = [];
  const fixes: string[] = [];
  for (const file of files) {
    let code = file.content;

    const icons = [...(missing.get(file.path) ?? [])].filter((n) => LUCIDE.has(n));
    if (icons.length) {
      code = addLucideImports(code, icons);
      fixes.push(`imported ${icons.join(", ")} from lucide-react in ${file.path}`);
    }

    for (const name of missing.get(file.path) ?? []) {
      const target = components.get(name);
      if (!LUCIDE.has(name) && target && target !== file.path) {
        code = `import ${name} from "${relativeImport(file.path, target)}";\n${code}`;
        fixes.push(`imported ${name} in ${file.path}`);
      }
    }

    const bad = [...(badIcons.get(file.path) ?? [])];
    const replaced = bad.length ? replaceMissingIcons(code, bad) : code;
    if (replaced !== code) {
      code = replaced;
      fixes.push(`replaced non-existent icon ${bad.join(", ")} with ${STAND_IN_ICON} in ${file.path}`);
    }

    if (code !== file.content) changed.push({ path: file.path, content: code });
  }

  writeSourceFiles(siteId, changed);
  return fixes;
}
