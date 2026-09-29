import { PREVIEW_URL } from "../config.js";
import type { Job } from "../store.js";
import { screenshotSlices } from "./capture.js";
import { formatFiles, parseModelOutput, readSourceFiles, writeSourceFiles } from "./files.js";
import { callModel, imagePart, textPart, ThinkingLevel } from "./llm.js";
import { REVIEW_SYSTEM } from "./prompts.js";

// Step 5: visual self-review. Validation only proves the code works; this step checks
// how it looks. The agent screenshots its own clone the same way it captured the
// original, shows the model each pair side by side, and applies the fixes it returns.
// Returns true when files were changed.
export async function reviewVisuals(job: Job, original: Buffer[]): Promise<boolean> {
  const clone = await screenshotSlices(`${PREVIEW_URL}/${job.id}/`);

  const pairs = original.flatMap((shot, i) => [
    textPart(`Original, part ${i + 1}:`),
    imagePart(shot),
    ...(clone[i]
      ? [textPart(`Clone, part ${i + 1}:`), imagePart(clone[i])]
      : [textPart(`Clone, part ${i + 1}: missing, the clone is shorter than the original.`)]),
  ]);

  const text = await callModel(job, {
    step: "review",
    system: REVIEW_SYSTEM,
    parts: [...pairs, textPart(`The clone's source files:\n\n${formatFiles(readSourceFiles(job.id))}`)],
    thinking: ThinkingLevel.MEDIUM,
    maxOutputTokens: 65536,
  });

  const { files, deletes, summary } = parseModelOutput(text);
  if (!files.length && !deletes.length) {
    job.log(`Visual review: ${summary ?? "no changes needed"}`);
    return false;
  }
  writeSourceFiles(job.id, files, deletes);
  job.log(`Visual review: ${summary ?? "fixed the biggest differences"} (${files.map((f) => f.path).join(", ")})`);
  return true;
}
