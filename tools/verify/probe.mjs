/**
 * The probe battery: everything this project asserts about a rendered page, measured in
 * ONE in-page evaluation.
 *
 * WHY IT IS ONE FUNCTION. The loop kept re-typing the same sRGB contrast arithmetic and
 * the same settled-state checks, slightly differently each time — which is how the "wrong
 * WCAG threshold applied to an 11px label" defect happened in the first place. One
 * definition, used everywhere, is both faster and the only version that can be audited.
 *
 * WHAT "SETTLED" MEANS, and why every measurement waits for it: a mid-animation
 * measurement measures a frame of the animation. `getBBox` includes descendant CSS
 * transforms, which is exactly how a design run once reported balanced margins for an SVG
 * whose content sat 14.4 units outside its viewBox. So: fonts ready, zero running
 * animations, then measure.
 *
 * WHAT IT REFUSES TO DO: decide. It returns numbers and states; the caller asserts. A
 * probe that returned PASS would be a second, weaker copy of the contract.
 */

/**
 * Source of the in-page function. Kept as a string because it is injected into the page,
 * not run here — and written to be dependency-free and side-effect-free (except the
 * deliberate settle wait).
 */
const PROBE_SOURCE = `
async function __foliageProbe(opts) {
  const sel = opts && opts.contrast ? opts.contrast : [];

  // ---- settle -------------------------------------------------------------
  await document.fonts.ready;
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const running = document.getAnimations().filter((a) => a.playState === "running");
    if (running.length === 0) break;
    await new Promise((r) => setTimeout(r, 50));
  }

  // ---- colour maths (ONE definition) --------------------------------------
  const chan = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const lum = (p) => 0.2126 * chan(p[0]) + 0.7152 * chan(p[1]) + 0.0722 * chan(p[2]);
  const rgb = (s) => { const m = String(s).match(/\\d+(\\.\\d+)?/g); return m ? [Number(m[0]), Number(m[1]), Number(m[2])] : [255,255,255]; };
  const bgOf = (el) => {
    let n = el;
    while (n) {
      const c = getComputedStyle(n).backgroundColor;
      if (c && !/rgba\\(0, 0, 0, 0\\)/.test(c)) return rgb(c);
      n = n.parentElement;
    }
    return [255, 255, 255];
  };
  const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b), hi = Math.max(l1,l2), lo = Math.min(l1,l2); return (hi + 0.05) / (lo + 0.05); };

  // ---- contrast, each pair judged at its OWN px size -----------------------
  const contrast = sel.map(({ name, selector, optional, optionalWhenEmpty }) => {
    const el = document.querySelector(selector);
    if (!el) return { name, selector, missing: true, optional: optional === true, optionalWhenEmpty };
    const cs = getComputedStyle(el);
    const px = parseFloat(cs.fontSize);
    const weight = parseInt(cs.fontWeight, 10) || 400;
    // 3:1 applies ONLY to large text: >=24px, or >=18.66px when bold.
    const large = px >= 24 || (px >= 18.66 && weight >= 700);
    const threshold = large ? 3 : 4.5;
    const value = ratio(rgb(cs.color), bgOf(el));
    return { name, px, weight, threshold, ratio: Math.round(value * 100) / 100, pass: value >= threshold };
  });

  // ---- structure ----------------------------------------------------------
  const counts = {};
  for (const [name, selector] of Object.entries((opts && opts.count) || {})) {
    counts[name] = document.querySelectorAll(selector).length;
  }

  const headings = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].map((h) => h.tagName);
  const focusable = [...document.querySelectorAll("a[href],button,input,[tabindex]:not([tabindex='-1'])")];

  return {
    url: location.href,
    title: document.title,
    settled: document.getAnimations().filter((a) => a.playState === "running").length === 0,
    fonts: { status: document.fonts.status, size: document.fonts.size,
             faces: [...document.fonts].map((f) => f.family + " " + f.weight + " " + f.status) },
    viewport: { innerWidth: innerWidth, innerHeight: innerHeight,
                scrollWidth: document.documentElement.scrollWidth,
                overflowsX: document.documentElement.scrollWidth > innerWidth },
    headings: headings.join(","),
    h1Count: headings.filter((t) => t === "H1").length,
    focusableCount: focusable.length,
    contrast,
    counts,
    // Anything the page renders that claims fabrication, and any score-shaped text —
    // both are invariants this project asserts on EVERY surface.
    fabricationMarkers: document.querySelectorAll("[data-fabricated]").length,
    scoreShapedText: (document.body.innerText.match(/\\b(rated|ranked|scored|graded|percentile)\\b|\\b\\d+\\s*\\/\\s*\\d+\\b|\\b\\d+\\s*%/gi) || []).slice(0, 10),
  };
}
`;

/** Build the code string to hand to neo's `evaluate` for one probe run. */
export function probeCode(opts = {}) {
  return `${PROBE_SOURCE}\nreturn await __foliageProbe(${JSON.stringify(opts)});`;
}
