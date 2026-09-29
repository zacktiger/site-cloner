import type { Capture, Screenshots } from "./capture.js";
import { callModel, imagePart, textPart, ThinkingLevel } from "./llm.js";
import { ANALYZE_SYSTEM } from "./prompts.js";
import type { Job } from "../store.js";

// Step 2: the model looks at the screenshots and the DOM outline and returns a
// structured plan (SiteSpec): the design tokens and the list of sections, each of
// which becomes one React component. The plan is JSON, enforced by a schema, so
// the code generator gets a predictable input and the UI can display it.

export interface SiteSpec {
  siteName: string;
  summary: string;
  theme: {
    colors: {
      primary: string;
      secondary: string;
      accent: string;
      background: string;
      surface: string;
      foreground: string;
      muted: string;
      border: string;
    };
    headingFont: string;
    bodyFont: string;
    style: string;
  };
  sections: {
    component: string;
    purpose: string;
    layout: string;
    content: string;
    mobile: string;
  }[];
}

const hexColor = { type: "string", description: "hex color like #1a2b3c" };

const SPEC_SCHEMA = {
  type: "object",
  properties: {
    siteName: { type: "string" },
    summary: { type: "string", description: "One sentence: what the site is and its visual style." },
    theme: {
      type: "object",
      properties: {
        colors: {
          type: "object",
          properties: {
            primary: { ...hexColor, description: "main brand / call-to-action color" },
            secondary: hexColor,
            accent: hexColor,
            background: { ...hexColor, description: "page background" },
            surface: { ...hexColor, description: "cards and raised panels" },
            foreground: { ...hexColor, description: "main text color" },
            muted: { ...hexColor, description: "secondary text color" },
            border: hexColor,
          },
          required: ["primary", "secondary", "accent", "background", "surface", "foreground", "muted", "border"],
        },
        headingFont: { type: "string", description: "Google Fonts family name closest to the heading font" },
        bodyFont: { type: "string", description: "Google Fonts family name closest to the body font" },
        style: { type: "string", description: "corner radius, shadows, borders, density, light or dark" },
      },
      required: ["colors", "headingFont", "bodyFont", "style"],
    },
    sections: {
      type: "array",
      description: "Every visible section from top to bottom, including navbar and footer.",
      items: {
        type: "object",
        properties: {
          component: { type: "string", description: "PascalCase component name, e.g. Navbar, Hero, Pricing, Footer" },
          purpose: { type: "string" },
          layout: { type: "string", description: "columns, alignment, background, spacing, sizes" },
          content: { type: "string", description: "the actual texts, buttons, links and image ids (img#N) it contains" },
          mobile: { type: "string", description: "how it should adapt on a phone" },
        },
        required: ["component", "purpose", "layout", "content", "mobile"],
      },
    },
  },
  required: ["siteName", "summary", "theme", "sections"],
};

// The facts measured by the browser, written out for the model.
export function describeCapture(capture: Capture): string {
  const assets = capture.assets.map(
    (a) => `${a.id}: ${a.src} (${a.width}x${a.height}${a.alt ? `, "${a.alt}"` : ""}${a.decorative ? ", decorative overlay: do not use as content" : ""})`,
  );
  return [
    `URL: ${capture.url}`,
    `Title: ${capture.title}`,
    capture.description && `Meta description: ${capture.description}`,
    `Most used background colors (by area): ${capture.colors.backgrounds.join(", ")}`,
    `Most used text colors: ${capture.colors.text.join(", ")}`,
    `Button colors: ${capture.colors.accents.join(", ") || "none found"}`,
    `Heading fonts: ${capture.fonts.heading.join(", ")} | Body fonts: ${capture.fonts.body.join(", ")}`,
    capture.fonts.googleFontsLinks.length > 0 && `Google Fonts used: ${capture.fonts.googleFontsLinks.join(" ")}`,
    "",
    "Images (use these exact URLs):",
    assets.join("\n") || "none",
    "",
    `DOM outline${capture.truncated ? " (some dense detail was trimmed)" : ""}:`,
    capture.outline,
  ]
    .filter((line) => line !== false && line !== undefined)
    .join("\n");
}

export async function analyzeSite(job: Job, capture: Capture, shots: Screenshots): Promise<SiteSpec> {
  const text = await callModel(job, {
    step: "analyze",
    system: ANALYZE_SYSTEM,
    parts: [
      textPart("Desktop screenshots, top to bottom:"),
      ...shots.desktopSlices.map(imagePart),
      textPart("Mobile screenshot (first two screens):"),
      imagePart(shots.mobile),
      textPart(describeCapture(capture)),
    ],
    jsonSchema: SPEC_SCHEMA,
    thinking: ThinkingLevel.LOW,
    maxOutputTokens: 16384,
  });

  let spec: SiteSpec;
  try {
    spec = JSON.parse(text);
  } catch {
    throw new Error("The analysis step returned invalid JSON");
  }
  if (!spec.sections?.length) throw new Error("The analysis found no sections on the page");

  // Component names become file names, so keep them safe and unique.
  const seen = new Set<string>();
  for (const section of spec.sections) {
    let name = section.component.replace(/[^A-Za-z0-9]/g, "") || "Section";
    name = name[0].toUpperCase() + name.slice(1);
    if (/^\d/.test(name) || name === "App") name = `Section${name}`;
    let unique = name;
    for (let i = 2; seen.has(unique); i++) unique = `${name}${i}`;
    seen.add(unique);
    section.component = unique;
  }
  return spec;
}
