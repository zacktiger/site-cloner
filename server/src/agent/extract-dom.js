// Runs INSIDE the target web page (injected by capture.ts through Playwright).
//
// Raw HTML is huge and mostly noise (scripts, tracking, deeply nested wrapper divs).
// This script walks the rendered DOM and writes a short indented outline that keeps
// only what matters for rebuilding the UI: structure, text, images, layout and colors.
// A 500 KB page usually becomes 10-25 KB of outline, which is what the model reads.
(() => {
  const MAX_LINES = 600;
  const MAX_DEPTH = 10; // deeper nesting is usually decoration (UI mockups inside cards)
  const MAX_TEXT = 160;
  const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "IFRAME", "META", "LINK", "OBJECT", "CANVAS"]);
  const INLINE = new Set(["SPAN", "A", "STRONG", "EM", "B", "I", "BR", "SMALL", "CODE", "SUP", "SUB", "MARK", "U", "S", "ABBR", "TIME"]);
  const SEMANTIC = new Set(["header", "nav", "main", "section", "footer", "aside", "article", "form", "ul", "ol"]);
  const viewportWidth = window.innerWidth;
  const pageHeight = document.documentElement.scrollHeight;

  // The line budget is spread over the page height, so one dense section (e.g. a
  // detailed UI mockup) cannot use up the whole outline and hide the sections below it.
  const budgetAt = (bottom) => 40 + MAX_LINES * (bottom / pageHeight);

  const lines = [];
  const push = (line) => lines[lines.length - 1] !== line && lines.push(line); // drops exact duplicates
  const assets = [];
  const assetIds = new Map();
  const tallies = { background: new Map(), text: new Map(), accent: new Map(), headingFont: new Map(), bodyFont: new Map() };
  let truncated = false;

  const tally = (map, key, weight) => key && map.set(key, (map.get(key) || 0) + weight);
  const top = (map, n) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);
  const clean = (t) => (t || "").replace(/\s+/g, " ").trim();
  const clip = (t) => (t.length > MAX_TEXT ? t.slice(0, MAX_TEXT) + "…" : t);
  const px = (n) => Math.round(n);

  // "rgb(10, 37, 64)" -> "#0a2540"; transparent colors -> null
  function hex(color) {
    const m = color && color.match(/rgba?\(([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?/);
    if (!m) return null;
    if (m[4] !== undefined && parseFloat(m[4]) < 0.1) return null;
    return "#" + [m[1], m[2], m[3]].map((v) => (+v).toString(16).padStart(2, "0")).join("");
  }

  function asset(src, alt, rect, decorative = false) {
    if (!src || (src.startsWith("data:") && src.length > 3000)) return null;
    if (!assetIds.has(src)) {
      assetIds.set(src, `img#${assets.length + 1}`);
      assets.push({ id: `img#${assets.length + 1}`, src, alt: clean(alt), width: px(rect.width), height: px(rect.height), decorative });
    }
    return assetIds.get(src);
  }

  // Images shown faintly or blended (grain, noise, glow textures) are decoration, not content.
  // Opacity is not inherited in computed styles, so it is multiplied up the ancestors.
  function isDecorative(el) {
    let opacity = 1;
    for (let e = el; e && e !== document.body; e = e.parentElement) {
      const s = getComputedStyle(e);
      opacity *= parseFloat(s.opacity);
      if (s.mixBlendMode !== "normal") return true;
    }
    return opacity < 0.5;
  }

  const isHidden = (s) => s.display === "none" || s.visibility === "hidden" || parseFloat(s.opacity) < 0.05;
  // Zero-size wrappers still count when their children overflow out of them,
  // unless they clip (a collapsed dropdown menu is zero-height with overflow hidden).
  const isVisible = (el) => {
    const s = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (isHidden(s)) return false;
    if (r.width > 1 && r.height > 1) return true;
    return el.children.length > 0 && s.overflow !== "hidden" && s.overflow !== "clip";
  };

  // Text that belongs to the element itself, e.g. "Products" in <button>Products<svg/></button>
  const ownText = (el) => clean([...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(" "));
  const sameBox = (a, b) => b && Math.abs(a.top - b.top) < 2 && Math.abs(a.height - b.height) < 2;

  // A "text block" only contains inline children, so its full text can be read at once.
  const isTextBlock = (el) => [...el.children].every((c) => INLINE.has(c.tagName) && !c.querySelector("img,svg"));

  // How many children sit side by side on the first row: 1 = stacked, 3 = three columns.
  function columns(children) {
    if (children.length < 2) return 1;
    const firstTop = children[0].getBoundingClientRect().top;
    return children.filter((c) => Math.abs(c.getBoundingClientRect().top - firstTop) < 6).length;
  }

  function describe(el, s, r, visibleChildren, parentBg, parentRect) {
    const tag = el.tagName.toLowerCase();
    const notes = [];
    const bg = hex(s.backgroundColor);
    const isAction = tag === "a" || tag === "button" || el.getAttribute("role") === "button";
    const isHeading = /^h[1-6]$/.test(tag);
    const isBigBlock = r.width > viewportWidth * 0.8 && r.height > 150;

    if (el.id && el.id.length < 30 && !/\d{3,}/.test(el.id)) notes.push(`#${el.id}`);
    if (s.position === "fixed" || s.position === "sticky") notes.push(`position=${s.position}`);

    const cols = columns(visibleChildren);
    if (cols > 1) notes.push(`cols=${cols}`);
    else if (s.display.includes("grid")) notes.push("grid");

    if (bg && bg !== parentBg) notes.push(`bg=${bg}`);
    if (s.backgroundImage.includes("gradient")) notes.push(`bg=${clip(s.backgroundImage)}`);
    const bgUrl = s.backgroundImage.match(/url\(["']?([^"')]+)["']?\)/);
    if (bgUrl) notes.push(`bg-image=${asset(bgUrl[1], "", r)}`);

    if (isHeading || (isAction && bg)) notes.push(`font=${px(parseFloat(s.fontSize))}px/${s.fontWeight}`);
    if (isAction && bg) {
      notes.push(`color=${hex(s.color)}`);
      if (parseFloat(s.borderRadius) > 0) notes.push(`radius=${s.borderRadius}`);
      tally(tallies.accent, bg, 1);
    }
    // Position/size of large blocks; skipped for wrappers that exactly cover their parent.
    if ((isBigBlock || SEMANTIC.has(tag)) && !sameBox(r, parentRect)) notes.push(`[y=${px(r.top + scrollY)} h=${px(r.height)}]`);

    const worthPrinting =
      isHeading || isAction || SEMANTIC.has(tag) || notes.some((n) => n.startsWith("bg")) || cols > 1 || (isBigBlock && !sameBox(r, parentRect));
    return { worthPrinting, notes, bg: bg || parentBg, isAction };
  }

  function walk(el, depth, parentBg, parentRect) {
    if (lines.length >= MAX_LINES) return void (truncated = true);
    if (SKIP.has(el.tagName) || depth > MAX_DEPTH) return;

    const s = getComputedStyle(el);
    if (isHidden(s)) return;
    const r = el.getBoundingClientRect();
    const tag = el.tagName.toLowerCase();
    const indent = "  ".repeat(depth);
    const overBudget = r.height > 1 && lines.length > budgetAt(r.bottom + scrollY);
    if (overBudget && !/^h[1-3]$/.test(tag)) return void (truncated = true);

    if (r.width * r.height > 0) tally(tallies.background, hex(s.backgroundColor), r.width * r.height);

    if (tag === "img") {
      if (r.width < 2) return;
      const decorative = isDecorative(el);
      const id = asset(el.currentSrc || el.src, el.alt, r, decorative);
      if (id) push(`${indent}img ${id}${el.alt ? ` "${clip(clean(el.alt))}"` : ""} ${px(r.width)}x${px(r.height)}${decorative ? " (decorative overlay)" : ""}`);
      return;
    }
    if (tag === "svg") {
      if (r.width > 1) push(`${indent}icon ${px(r.width)}x${px(r.height)}${el.getAttribute("aria-label") ? ` "${el.getAttribute("aria-label")}"` : ""}`);
      return;
    }
    if (tag === "video") {
      push(`${indent}video ${px(r.width)}x${px(r.height)}${el.poster ? ` poster=${asset(el.poster, "", r)}` : ""}`);
      return;
    }
    if (tag === "input" || tag === "textarea" || tag === "select") {
      push(`${indent}${tag}${el.type ? `[${el.type}]` : ""}${el.placeholder ? ` placeholder="${clip(el.placeholder)}"` : ""}`);
      return;
    }

    const visibleChildren = [...el.children].filter((c) => !SKIP.has(c.tagName) && isVisible(c));
    const info = describe(el, s, r, visibleChildren, parentBg, parentRect);

    // Leaf text: headings, paragraphs, buttons, links, list items with only inline children.
    if (isTextBlock(el)) {
      const text = clip(clean(el.innerText));
      if (!text && !info.worthPrinting) return;
      if (text) {
        tally(tallies.text, hex(s.color), text.length);
        tally(/^h[1-3]$/.test(tag) ? tallies.headingFont : tallies.bodyFont, s.fontFamily.split(",")[0].replace(/["']/g, "").trim(), text.length);
      }
      const href = tag === "a" && el.getAttribute("href") ? ` -> ${clip(el.getAttribute("href"))}` : "";
      push(`${indent}${tag}${info.notes.length ? " " + info.notes.join(" ") : ""}${text ? ` "${text}"` : ""}${href}`);
      return;
    }

    // Wrapper divs that add nothing are skipped; their children move up one level.
    const text = clip(ownText(el));
    let childDepth = depth;
    if (info.worthPrinting || text) {
      push(`${indent}${tag}${info.notes.length ? " " + info.notes.join(" ") : ""}${text ? ` "${text}"` : ""}`);
      childDepth = depth + 1;
    }

    // Long repeated lists (logos, links, cards) are cut to the first 8 items. The images of
    // the hidden items are still listed, so the model never has to invent their URLs.
    const shown = visibleChildren.slice(0, 8);
    for (const child of shown) walk(child, childDepth, info.bg, r);
    if (visibleChildren.length > shown.length) {
      const hiddenImages = visibleChildren
        .slice(shown.length)
        .flatMap((c) => [...c.querySelectorAll("img")])
        .map((img) => asset(img.currentSrc || img.src, img.alt, img.getBoundingClientRect()))
        .filter(Boolean);
      const imageNote = hiddenImages.length ? ` (their images: ${hiddenImages.join(", ")})` : "";
      push(`${"  ".repeat(childDepth)}... ${visibleChildren.length - shown.length} more similar items${imageNote}`);
    }
  }

  walk(document.body, 0, null, null);

  const googleFontsLinks = [...document.querySelectorAll('link[href*="fonts.googleapis.com"]')].map((l) => l.href);
  const loadedFonts = [...new Set([...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family.replace(/["']/g, "")))];

  return {
    title: document.title,
    description: document.querySelector('meta[name="description"]')?.content || "",
    outline: lines.join("\n"),
    truncated,
    assets,
    colors: {
      backgrounds: top(tallies.background, 8),
      text: top(tallies.text, 6),
      accents: top(tallies.accent, 6),
    },
    fonts: {
      heading: top(tallies.headingFont, 3),
      body: top(tallies.bodyFont, 3),
      loaded: loadedFonts.slice(0, 10),
      googleFontsLinks,
    },
    pageHeight: document.documentElement.scrollHeight,
    textLength: clean(document.body.innerText).length,
  };
})();
