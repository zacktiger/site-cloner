import fs from "node:fs";
import path from "node:path";
import { MAX_FIX_ATTEMPTS } from "../config.js";
import { createJob, readMeta, siteDataDir, updateMeta, type Job } from "../store.js";
import { analyzeSite } from "./analyze.js";
import { autoFixImports } from "./autofix.js";
import { captureWebsite } from "./capture.js";
import { formatFiles, parseModelOutput, readSourceFiles, restore, snapshot, writeSourceFiles } from "./files.js";
import { fixErrors, generateCode } from "./generate.js";
import { callModel, textPart, ThinkingLevel } from "./llm.js";
import { MODIFY_SYSTEM } from "./prompts.js";
import { scaffoldSite } from "./scaffold.js";
import { validateSite } from "./validate.js";

// The agent's control flow. Each step is a plain function call:
//
//   clone:  capture -> analyze -> scaffold -> generate -> validate/fix loop
//   modify: snapshot -> edit with AI -> validate/fix loop -> (roll back if still broken)

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

// Validate, and if something is wrong, fix it: first missing imports in code (free),
// then whatever is left with the model. At most MAX_FIX_ATTEMPTS model rounds.
async function validateAndFix(job: Job): Promise<boolean> {
  for (let attempt = 0; ; attempt++) {
    job.stage("validate");
    let errors = await validateSite(job.id);
    const autoFixes = errors.length ? autoFixImports(job.id, errors) : [];
    if (autoFixes.length) {
      job.log(`Fixed without AI: ${autoFixes.join("; ")}`);
      errors = await validateSite(job.id);
    }
    updateMeta(job.id, (m) => (m.validationErrors = errors));
    if (errors.length === 0) {
      job.log("Validation passed: type check and browser render are clean");
      return true;
    }
    job.log(`Validation found ${errors.length} problem(s). First: ${errors[0].split("\n")[0].slice(0, 200)}`);
    if (attempt >= MAX_FIX_ATTEMPTS) return false;
    job.stage("fix");
    job.log(`Asking the model to fix them (attempt ${attempt + 1}/${MAX_FIX_ATTEMPTS})`);
    await fixErrors(job, errors);
  }
}

export async function runClone(id: string, url: string) {
  const job = createJob(id);
  try {
    job.stage("capture");
    job.log(`Opening ${url} in a headless browser (desktop and mobile)`);
    const { capture, screenshots } = await captureWebsite(url);
    const dir = siteDataDir(id);
    fs.writeFileSync(path.join(dir, "original.jpg"), screenshots.fullPage);
    fs.writeFileSync(path.join(dir, "original-mobile.jpg"), screenshots.mobile);
    fs.writeFileSync(path.join(dir, "capture.json"), JSON.stringify(capture, null, 2));
    job.log(
      `Captured "${capture.title}": ${capture.outline.split("\n").length} outline lines, ` +
        `${capture.assets.length} images, ${screenshots.desktopSlices.length} screenshot slices`,
    );

    job.stage("analyze");
    job.log("Analyzing layout, sections, colors and fonts");
    const spec = await analyzeSite(job, capture, screenshots);
    updateMeta(id, (m) => (m.analysis = spec));
    job.log(`Found ${spec.sections.length} sections: ${spec.sections.map((s) => s.component).join(", ")}`);

    scaffoldSite(id, spec);

    job.stage("generate");
    job.log("Generating React components (this is the longest step)");
    await generateCode(job, capture, screenshots, spec);

    const ok = await validateAndFix(job);
    updateMeta(id, (m) => {
      m.status = "ready";
      m.stage = "done";
      if (!ok) m.error = "Some validation errors remain after automatic fixes. The preview may be partly broken.";
    });
    job.log(ok ? "Done. The clone is ready." : "Finished with remaining errors.");
  } catch (e) {
    job.log(`Failed: ${message(e)}`);
    updateMeta(id, (m) => {
      m.status = "failed";
      m.error = message(e);
    });
  }
}

export async function runModify(id: string, instruction: string) {
  const job = createJob(id);
  const version = readMeta(id)!.versions + 1;
  snapshot(id, version); // the state before this change, for undo and rollback
  updateMeta(id, (m) => {
    m.versions = version;
    m.status = "running";
    m.stage = "modify";
    m.error = undefined;
    m.changes.push({ instruction, time: new Date().toISOString(), status: "running", version });
  });
  const finish = (status: "applied" | "failed", summary: string) =>
    updateMeta(id, (m) => {
      const change = m.changes[m.changes.length - 1];
      change.status = status;
      change.summary = summary;
      m.status = "ready";
      m.stage = "done";
    });

  try {
    job.log(`Modifying: "${instruction}"`);
    const files = readSourceFiles(id);
    const text = await callModel(job, {
      step: "modify",
      system: MODIFY_SYSTEM,
      // The unchanged project comes first and the instruction last: Gemini caches
      // repeated prompt prefixes, so later edits of the same site cost less.
      parts: [textPart(`Current project files:\n\n${formatFiles(files)}`), textPart(`Instruction: ${instruction}`)],
      thinking: ThinkingLevel.LOW,
    });

    const { files: changed, deletes, summary } = parseModelOutput(text);
    if (!changed.length && !deletes.length) throw new Error("The model did not change any file");
    writeSourceFiles(id, changed, deletes);
    job.log(`Changed ${[...changed.map((f) => f.path), ...deletes.map((d) => `${d} (deleted)`)].join(", ")}`);

    if (!(await validateAndFix(job))) {
      throw new Error("The change broke the site and could not be fixed automatically");
    }
    finish("applied", summary ?? "Change applied");
    job.log("Change applied");
  } catch (e) {
    restore(id, version);
    updateMeta(id, (m) => (m.validationErrors = []));
    job.log(`Change failed and was rolled back: ${message(e)}`);
    finish("failed", message(e));
  }
}

export function undoLastChange(id: string) {
  const meta = readMeta(id)!;
  const change = [...meta.changes].reverse().find((c) => c.status === "applied");
  if (!change?.version) throw new Error("Nothing to undo");
  restore(id, change.version);
  updateMeta(id, (m) => {
    m.changes.find((c) => c.version === change.version)!.status = "undone";
    m.log.push({ time: new Date().toISOString(), message: `Undid: "${change.instruction}"` });
  });
}
