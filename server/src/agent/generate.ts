import fs from "node:fs";
import path from "node:path";
import { describeCapture, type SiteSpec } from "./analyze.js";
import type { Capture, Screenshots } from "./capture.js";
import { formatFiles, parseModelOutput, readSourceFiles, siteDir, writeSourceFiles } from "./files.js";
import { callModel, imagePart, textPart, ThinkingLevel } from "./llm.js";
import { FIX_SYSTEM, GENERATE_SYSTEM } from "./prompts.js";
import type { Job } from "../store.js";

// Step 3: write the React components from the plan, the screenshots and the DOM facts.
export async function generateCode(job: Job, capture: Capture, shots: Screenshots, spec: SiteSpec) {
  const expected = ["src/App.tsx", ...spec.sections.map((s) => `src/components/${s.component}.tsx`)];
  const themeCss = fs.readFileSync(path.join(siteDir(job.id), "src", "index.css"), "utf8");

  const text = await callModel(job, {
    step: "generate",
    system: GENERATE_SYSTEM,
    parts: [
      textPart("Screenshots of the original website, desktop, top to bottom:"),
      ...shots.desktopSlices.map(imagePart),
      textPart("Mobile screenshot:"),
      imagePart(shots.mobile),
      textPart(`Plan from the analysis step:\n${JSON.stringify(spec, null, 2)}`),
      textPart(describeCapture(capture)),
      textPart(`src/index.css already exists and must not be written. It defines the theme classes:\n${themeCss}`),
      textPart(`Write these files: ${expected.join(", ")}, plus any shared components in src/components/ui/.`),
    ],
    thinking: ThinkingLevel.MEDIUM,
    maxOutputTokens: 65536,
  });

  // index.css belongs to the scaffold; a rewritten one (e.g. in old Tailwind v3 syntax) breaks every color.
  const files = parseModelOutput(text).files.filter((f) => f.path !== "src/index.css");
  if (!files.some((f) => f.path === "src/App.tsx")) {
    throw new Error("The model's answer did not contain src/App.tsx");
  }
  writeSourceFiles(job.id, files);

  const missing = expected.filter((p) => !files.some((f) => f.path === p));
  job.log(`Wrote ${files.length} files${missing.length ? ` (not written: ${missing.join(", ")})` : ""}`);
}

// Step 4b: send the validation errors back to the model and apply its fixes.
// Only the files named in the errors are sent (plus App.tsx), which keeps the call
// small. A runtime error often names no file, and then the whole project is sent.
export async function fixErrors(job: Job, errors: string[]) {
  const all = readSourceFiles(job.id);
  const errorText = errors.join("\n");
  const urls = errorText.match(/https?:\/\/\S+/g) ?? [];
  const named = all.filter(
    (f) => f.path === "src/App.tsx" || errorText.includes(f.path) || urls.some((u) => f.content.includes(u)),
  );
  const context = named.length > 1 ? named : all;

  const text = await callModel(job, {
    step: "fix",
    system: FIX_SYSTEM,
    parts: [
      textPart(`All files in the project: ${all.map((f) => f.path).join(", ")}`),
      textPart(`Current contents of the relevant files:\n\n${formatFiles(context)}`),
      textPart(`Errors to fix:\n${errorText}`),
    ],
    thinking: ThinkingLevel.LOW,
  });

  const { files, deletes } = parseModelOutput(text);
  if (!files.length) throw new Error("The fix step returned no files");
  writeSourceFiles(job.id, files, deletes);
  job.log(`Fix applied to ${files.map((f) => f.path).join(", ")}`);
}
