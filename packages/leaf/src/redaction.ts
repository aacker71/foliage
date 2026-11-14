/**
 * THE REDACTION RULE — where in a piece of text something shaped like another person's identifier
 * sits, and that text with each one cut out.
 *
 * ONE RULE, TWO CALLERS, AND THEY DISAGREE ABOUT WHAT TO DO WITH A MATCH. This module takes no
 * position on that; each caller decides for itself:
 *
 *   `apps/leaf/export.mjs`            REFUSES to write while an offered title carries an address,
 *                                     names each one, and makes the person pass `--confirm`.
 *   `packages/canopy/src/publish.ts`  REDACTS the span and REPORTS it, for review before a leaf
 *                                     crosses to strangers.
 *
 * Both must find the SAME spans or they silently disagree about what an address is — F-021 in
 * `.loop/FINDINGS.md`. The export used to keep its own pattern without the apostrophe, so against
 * `contact o'brien@my-domain.example.com about it` it found only `brien@my-domain.example.com`.
 * It lives here, in the open plane, because canopy may import from leaf and leaf may never import
 * from canopy (`public-boundary.json`).
 *
 * A REGULAR EXPRESSION IS A FLOOR, NOT A PROOF. It finds text SHAPED like an identifier. A name
 * in ordinary prose is not found (only a git trailer carries one in a form a machine can find);
 * neither is an address written around the pattern (`rowan dot vale at example dot invalid`,
 * `user@localhost`, an IP-literal or non-ASCII domain). It also withholds more than it must:
 * `@media`, `@Override`, `@param` look like account handles. `PUBLICATION_LIMITS` in canopy says
 * the same to the person deciding. An empty result means this rule found nothing — never that the
 * text is free of personal data.
 *
 * THE SPAN, NOT THE WHOLE STRING. `redactIdentifiers` replaces its own matched range and leaves
 * the rest standing, so a false positive costs a few characters rather than a whole title.
 *
 * PURE AND TOTAL: no fs, no network, no clock, no randomness, no throw.
 */

/**
 * The classes of thing this rule detects, named for the SHAPE matched rather than a conclusion
 * about who is described. "account-handle" is honest; "third party" would not be — `@media` matches.
 */
export type DetectedKind = "email-address" | "identity-trailer" | "account-handle" | "phone-number";

/** One detected span, already merged with every overlap in the same text. */
export interface RedactionSpan {
  readonly start: number;
  readonly end: number;
  readonly kind: DetectedKind;
}

interface Detector {
  readonly kind: DetectedKind;
  readonly pattern: RegExp;
  /** What replaces the matched span. Non-empty, so a fully-redacted title stays renderable. */
  readonly placeholder: string;
  /** How a reason names this class, in prose. */
  readonly describes: string;
}

/*
 * Four patterns, each a floor. Declared in the order they win an overlap: a `Co-authored-by:`
 * trailer contains an address, and reporting the trailer (name AND address) tells a reviewer
 * more than the address alone, so it is listed first and the merge prefers the earlier, longer span.
 */
const DETECTORS: readonly Detector[] = Object.freeze([
  {
    // Git's own trailer convention: `Key: Value`. The one place a second person's NAME appears in
    // a form a machine can find. Consumes to end of line: the whole value is the person.
    kind: "identity-trailer",
    pattern:
      /(?<![A-Za-z0-9-])(?:(?:co-authored|signed-off|reviewed|acked|tested|reported|suggested|helped|mentored|requested|noticed|analyzed|thanks)-by|cc)\s*:[^\n]*/gi,
    placeholder: "[withheld: a co-author credit naming another person]",
    describes: "a git identity trailer, which names another person and usually their address",
  },
  {
    // An address shape, and the UNION of the two patterns F-021 found disagreeing, so unifying
    // them narrowed neither: the local part takes the apostrophe (`o'brien`, which only the
    // publication gate took), and the domain takes any run of letters, digits, dots and hyphens
    // (so a typo'd `rowan@northwind..invalid`, which only the export took, is still an address).
    // The TLD must be alphabetic and at least two characters, which keeps `npm@1.2.3` — a
    // version pin — from being eaten; the cost is a false negative on `user@localhost`.
    kind: "email-address",
    pattern: /[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
    placeholder: "[withheld: email address]",
    describes: "text shaped like an email address",
  },
  {
    // An @-mention. The lookbehind keeps it off the `@` inside an address (matched above), and
    // `(?!\/)` keeps it off scoped package names — `@types/node` and `@foliage/leaf` are
    // dependencies, not people. CSS at-rules and annotations still match: over-withholding, the
    // safe direction, and stated in canopy's limits.
    kind: "account-handle",
    pattern: /(?<![A-Za-z0-9._%+'-])@[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?(?!\/)\b/g,
    placeholder: "[withheld: account handle]",
    describes: "text shaped like an account handle",
  },
  {
    // A telephone number, in the two shapes that cannot be confused with the numbers commit
    // messages are full of. Separators are MANDATORY in the grouped form, so a sha, a timestamp,
    // a version and a byte count all fail to match; the compact form requires a leading `+`.
    kind: "phone-number",
    pattern:
      /(?<![\d+-])(?:\+\d{8,15}(?!\d)|(?:\+\d{1,3}[ .-]?)?(?:\(\d{3}\)[ .-]?|\d{3}[ .-])\d{3}[ .-]\d{4}(?![\d-]))/g,
    placeholder: "[withheld: telephone number]",
    describes: "text shaped like a telephone number",
  },
]);

const ALL_KINDS: readonly DetectedKind[] = Object.freeze(DETECTORS.map((d) => d.kind));

/** How a reason names each detected class, in prose — one table, beside the patterns it names. */
export const REDACTION_DESCRIPTIONS: ReadonlyMap<DetectedKind, string> = new Map(
  DETECTORS.map((d) => [d.kind, d.describes] as const),
);

const PLACEHOLDER: ReadonlyMap<DetectedKind, string> = new Map(
  DETECTORS.map((d) => [d.kind, d.placeholder] as const),
);

interface MutableSpan {
  start: number;
  end: number;
  kind: DetectedKind;
}

/**
 * Every detection in one string, as non-overlapping spans in document order.
 *
 * `kinds` runs only the named detectors BEFORE overlaps merge — so asking for addresses alone
 * still finds an address inside a trailer, instead of losing it to the trailer's wider span.
 *
 * Overlap resolution is EXTENDING, not discarding: where a later span starts inside an earlier one
 * and reaches further, the earlier span grows to cover it. Discarding the tail would be a silent
 * under-redaction. O(k·n) to scan with k fixed patterns, then O(m log m) to sort m detections.
 */
export function detectRedactableSpans(
  text: string,
  kinds: readonly DetectedKind[] = ALL_KINDS,
): readonly RedactionSpan[] {
  const found: MutableSpan[] = [];
  for (const d of DETECTORS) {
    if (!kinds.includes(d.kind)) continue;
    d.pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = d.pattern.exec(text)) !== null) {
      if (m[0].length === 0) {
        d.pattern.lastIndex += 1;
        continue;
      }
      found.push({ start: m.index, end: m.index + m[0].length, kind: d.kind });
    }
  }
  // Earliest first; on a tie the longer span wins; on a further tie the declaration order decides.
  // All three keys are total, so the result is deterministic for any input.
  const order = (k: DetectedKind): number => DETECTORS.findIndex((d) => d.kind === k);
  found.sort((a, b) => a.start - b.start || b.end - a.end || order(a.kind) - order(b.kind));

  const merged: MutableSpan[] = [];
  for (const s of found) {
    const last = merged[merged.length - 1];
    if (last !== undefined && s.start < last.end) {
      if (s.end > last.end) last.end = s.end;
      continue;
    }
    merged.push(s);
  }
  return merged;
}

/** What `redactIdentifiers` produced: the text with every detected span replaced, and the spans. */
export interface Redaction {
  /** Equal to the input when nothing was found. */
  readonly text: string;
  readonly spans: readonly RedactionSpan[];
}

/** Replace every detected span with its class's placeholder. Pure; O(n) in the text. */
export function redactIdentifiers(text: string): Redaction {
  const spans = detectRedactableSpans(text);
  if (spans.length === 0) return { text, spans };
  let out = "";
  let cursor = 0;
  for (const s of spans) {
    out += text.slice(cursor, s.start) + (PLACEHOLDER.get(s.kind) ?? "[withheld]");
    cursor = s.end;
  }
  return { text: out + text.slice(cursor), spans };
}
