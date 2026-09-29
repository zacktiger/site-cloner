import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Page } from "playwright";

// Step 1 of the agent: open the real website in a headless browser and record
//   - screenshots (what it looks like, desktop and mobile)
//   - a compact DOM outline, colors, fonts and image URLs (what it is made of)
// No AI is involved here. It is cheap, deterministic and gives the model facts
// (exact text, exact hex colors, real image URLs) so it does not have to guess them.

export interface Asset {
  id: string; // "img#3", the name used for this image in the outline
  src: string;
  alt: string;
  width: number;
  height: number;
  decorative: boolean; // faint or blended texture, not real content
}

export interface Capture {
  url: string;
  title: string;
  description: string;
  outline: string;
  truncated: boolean;
  assets: Asset[];
  colors: { backgrounds: string[]; text: string[]; accents: string[] };
  fonts: { heading: string[]; body: string[]; loaded: string[]; googleFontsLinks: string[] };
  pageHeight: number;
  textLength: number;
}

export interface Screenshots {
  desktopSlices: Buffer[]; // top of the page cut into tall slices, sent to the model
  mobile: Buffer; // first two screens on a phone
  fullPage: Buffer; // shown in the UI next to the clone
}

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };
const SLICE_HEIGHT = 1800;
const MAX_SLICES = 4; // caps image tokens: long pages are covered by the text outline instead
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const MOBILE_USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

const EXTRACT_SCRIPT = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "extract-dom.js"),
  "utf8",
);

let browser: Browser | null = null;
export async function getBrowser() {
  if (!browser?.isConnected()) {
    browser = await chromium.launch().catch((e: Error) => {
      const exitCode = e.message.match(/exitCode=(-?\d+)/)?.[1];
      throw new Error(
        `The headless browser could not start${exitCode ? ` (exit code ${exitCode})` : ""}. ` +
          "Stop every running copy of the app, start `npm run dev` again from a terminal, and retry. " +
          "If it still fails, run `npx --prefix server playwright install chromium`.",
      );
    });
  }
  return browser;
}

// Playwright's navigation errors are long and technical; say what went wrong in one sentence.
function explainLoadError(message: string) {
  const code = message.match(/net::(ERR_[A-Z_]+)/)?.[1];
  if (code === "ERR_NAME_NOT_RESOLVED") return "This domain does not exist (DNS lookup failed). Check the URL.";
  if (code === "ERR_CONNECTION_REFUSED" || code === "ERR_CONNECTION_RESET") return `The server refused the connection (${code}).`;
  if (code?.startsWith("ERR_CERT")) return `The site's HTTPS certificate is invalid (${code}).`;
  if (/Timeout/i.test(message)) return "The page took longer than 45 seconds to load.";
  return `Could not open the page: ${message.split("\n")[0]}`;
}

async function openPage(url: string, mobile: boolean): Promise<Page> {
  const context = await (await getBrowser()).newContext({
    viewport: mobile ? MOBILE : DESKTOP,
    userAgent: mobile ? MOBILE_USER_AGENT : USER_AGENT,
    isMobile: mobile,
    hasTouch: mobile,
    locale: "en-US",
  });
  const page = await context.newPage();
  const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 }).catch((e: Error) => {
    void context.close();
    throw new Error(explainLoadError(e.message));
  });
  if (res && res.status() >= 400) throw new Error(`The website answered with HTTP ${res.status()}`);
  // Many sites keep polling forever, so "network idle" is a best effort, not a requirement.
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
  // `content-visibility: auto` makes Chrome skip rendering off-screen sections, which
  // hides their text from the DOM walk and leaves blank areas in full-page screenshots.
  await page.addStyleTag({ content: "*, *::before, *::after { content-visibility: visible !important; }" });
  await scrollThrough(page);
  return page;
}

// Scroll to the bottom and back so lazy-loaded images and scroll animations appear.
async function scrollThrough(page: Page) {
  await page.evaluate(async () => {
    for (let y = 0; y < document.documentElement.scrollHeight && y < 20_000; y += 600) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 80));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(800);
}

// The top of the page as tall slices (max MAX_SLICES), used for the original and the clone alike.
async function takeSlices(page: Page): Promise<Buffer[]> {
  const height = Math.min((await page.evaluate("document.documentElement.scrollHeight")) as number, 16_000);
  const slices: Buffer[] = [];
  for (let y = 0; y < height && slices.length < MAX_SLICES; y += SLICE_HEIGHT) {
    const clip = { x: 0, y, width: DESKTOP.width, height: Math.min(SLICE_HEIGHT, height - y) };
    slices.push(await page.screenshot({ clip, fullPage: true, type: "jpeg", quality: 70, animations: "disabled" }));
  }
  return slices;
}

// Screenshots of a generated site, taken exactly like the original's, for the visual review.
export async function screenshotSlices(url: string): Promise<Buffer[]> {
  const page = await openPage(url, false);
  try {
    return await takeSlices(page);
  } finally {
    await page.context().close();
  }
}

const BLOCKED_TITLES = /just a moment|attention required|access denied|verify you are human|captcha/i;

export async function captureWebsite(url: string): Promise<{ capture: Capture; screenshots: Screenshots }> {
  const pages = await Promise.allSettled([openPage(url, false), openPage(url, true)]);
  const failed = pages.find((p) => p.status === "rejected");
  if (failed) {
    for (const p of pages) if (p.status === "fulfilled") await p.value.context().close();
    throw failed.reason;
  }
  const [desktop, mobile] = pages.map((p) => (p as PromiseFulfilledResult<Page>).value);
  try {
    const facts = (await desktop.evaluate(EXTRACT_SCRIPT)) as Omit<Capture, "url">;

    if (BLOCKED_TITLES.test(facts.title)) {
      throw new Error(`The site showed a bot-protection page ("${facts.title}"), so it cannot be captured headlessly`);
    }
    if (facts.textLength < 50 && facts.assets.length === 0) {
      throw new Error("The page rendered almost nothing (it may need a login or block headless browsers)");
    }

    const desktopSlices = await takeSlices(desktop);
    const fullPage = await desktop.screenshot({ fullPage: true, type: "jpeg", quality: 60, animations: "disabled" });
    const mobileHeight = await mobile.evaluate(() => document.documentElement.scrollHeight);
    const mobileShot = await mobile.screenshot({
      clip: { x: 0, y: 0, width: MOBILE.width, height: Math.min(MOBILE.height * 2, mobileHeight) },
      fullPage: true,
      type: "jpeg",
      quality: 70,
      animations: "disabled",
    });

    return {
      capture: { url, ...facts },
      screenshots: { desktopSlices, mobile: mobileShot, fullPage },
    };
  } finally {
    await desktop.context().close();
    await mobile.context().close();
  }
}
