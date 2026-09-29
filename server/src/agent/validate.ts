import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { PREVIEW_DIR, PREVIEW_URL } from "../config.js";
import { getBrowser } from "./capture.js";

// Step 4: check that the generated code actually works, in two layers:
//   1. Type check with the TypeScript compiler: missing imports, wrong props,
//      syntax errors. Fast, and the error points to an exact file and line.
//   2. Open the site in headless Chrome through the preview server: catches what
//      only shows up when running (crashes during render, a blank page, a module
//      Vite cannot compile).
// It returns a list of readable error messages; an empty list means the site is valid.

const TSC = path.join(PREVIEW_DIR, "node_modules", "typescript", "bin", "tsc");
const MAX_ERRORS = 15;

function typeCheck(id: string): Promise<string[]> {
  return new Promise((resolve) => {
    const tsconfig = path.join("sites", id, "tsconfig.json");
    execFile(process.execPath, [TSC, "--noEmit", "--pretty", "false", "-p", tsconfig], { cwd: PREVIEW_DIR, timeout: 90_000 }, (err, stdout) => {
      if (!err) return resolve([]);
      // "sites/<id>/src/App.tsx(3,8): error TS2307: Cannot find module ..." -> "src/App.tsx(3,8): ..."
      // Continuation lines (indented) belong to the error above them.
      const errors: string[] = [];
      for (const line of stdout.split(/\r?\n/)) {
        if (!line.trim()) continue;
        const cleaned = line.replaceAll(`sites/${id}/`, "").replaceAll(`sites\\${id}\\`, "");
        if (/^\s/.test(line) && errors.length) errors[errors.length - 1] += "\n" + cleaned;
        else errors.push(cleaned);
      }
      resolve(errors.length ? errors.slice(0, MAX_ERRORS) : [`TypeScript failed: ${err.message}`]);
    });
  });
}

async function renderCheck(id: string): Promise<string[]> {
  const errors: string[] = [];
  const context = await (await getBrowser()).newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  page.on("pageerror", (e) => errors.push(`Runtime error while rendering: ${e.message}`));
  page.on("response", (res) => {
    // A source module that fails to load means Vite could not compile it.
    const url = res.url();
    if (res.status() >= 400 && url.startsWith(PREVIEW_URL) && /\.(tsx?|css)(\?|$)/.test(url)) {
      errors.push(`Module failed to load (HTTP ${res.status()}): ${url.replace(`${PREVIEW_URL}/${id}/`, "")}`);
    }
  });

  try {
    await page.goto(`${PREVIEW_URL}/${id}/`, { waitUntil: "load", timeout: 30_000 });
    await page.waitForTimeout(1500);
    const overlay = (await page.evaluate(
      `document.querySelector("vite-error-overlay")?.shadowRoot?.querySelector(".window")?.textContent ?? ""`,
    )) as string;
    if (overlay) errors.push(`Vite error: ${overlay.replaceAll(`/sites/${id}/`, "").slice(0, 1500)}`);
    const rootChildren = (await page.evaluate(`document.getElementById("root")?.children.length ?? 0`)) as number;
    if (rootChildren === 0 && errors.length === 0) errors.push("The page rendered nothing: #root is empty");
  } catch (e) {
    errors.push(`Preview did not load (is the preview server running on ${PREVIEW_URL}?): ${(e as Error).message}`);
  } finally {
    await context.close();
  }
  return [...new Set(errors)].slice(0, MAX_ERRORS);
}

// Without the @theme block, classes like bg-primary produce no CSS. Nothing crashes,
// the colors just silently disappear, so this is checked explicitly.
function checkThemeCss(id: string): string[] {
  const css = fs.readFileSync(path.join(PREVIEW_DIR, "sites", id, "src", "index.css"), "utf8");
  if (/@theme\s*\{/.test(css)) return [];
  return [
    "src/index.css: the @theme { --color-...; --font-...; } block is missing, so theme classes like bg-primary produce no CSS. Restore it in Tailwind v4 syntax.",
  ];
}

export async function validateSite(id: string): Promise<string[]> {
  const staticErrors = [...checkThemeCss(id), ...(await typeCheck(id))];
  if (staticErrors.length) return staticErrors; // no point rendering code that does not compile
  return renderCheck(id);
}
