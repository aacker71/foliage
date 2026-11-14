import { blurFade } from "./magicUi.ts";
import { esc, glyph, shell } from "./renderTree.ts";

export interface DemoInput {
  readonly work: string;
  readonly staticExport?: boolean;
}

function linesOf(work: string): readonly string[] {
  return work
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, 6);
}

function demoLeaflet(line: string, index: number): string {
  return `<li class="pub-item demo-item" data-demo-leaflet="true">
<div>
<h3 class="pub-item-title" data-verbatim="title">${esc(line)}</h3>
<p class="pub-item-ref"><span class="fol-label">Input line</span><span class="fol-metric">${index + 1}</span></p>
</div>
<p class="pub-item-tier"><span class="proof proof-pending" data-pill-tier="pending">${glyph("i-partial", 14)}Pending</span></p>
</li>`;
}

function preview(work: string): string {
  const lines = linesOf(work);
  if (lines.length === 0) {
    return `<section class="pub-empty demo-preview" aria-labelledby="demo-preview-h">
<div class="plate">
${glyph("i-alert", 20)}
<h2 id="demo-preview-h" class="plate-t">Paste work text to create a preview.</h2>
<p class="plate-b">Nothing yet</p>
</div>
</section>`;
  }

  return `<section class="pub-published demo-preview" aria-labelledby="demo-preview-h">
<div class="pub-subject">
<span class="fol-label">Demo Leaf</span>
<h2 id="demo-preview-h">Preview from your text</h2>
<p class="pub-scope">From your text only · pending, no cryptographic authorship check</p>
<div class="cell pub-count"><span class="fol-label">Preview artifacts</span><b class="fol-metric">${lines.length}</b></div>
</div>
<ul class="pub-list">
${lines.map(demoLeaflet).join("\n")}
</ul>
</section>`;
}

export function renderDemoPage(input: DemoInput): string {
  return shell({
    title: "Foliage — demo",
    surface: "demo",
    state: input.work.trim().length === 0 ? "empty" : "preview",
    body: `${blurFade(`<section class="launch-hero demo-hero">
<div class="launch-hero-copy">
<span class="fol-label">Demo</span>
<h1>Try a Leaflet preview with your own text.</h1>
<p class="launch-lede">Paste work to preview</p>
</div>
<div class="launch-figure" aria-hidden="true">
<svg class="m" width="180" height="205"><use href="#fol-mark-x"></use></svg>
</div>
</section>`)}
${input.staticExport ? '<section class="launch-section"><h2>Read-only export</h2><p>Read-only export · preview needs the app</p></section>' : blurFade(`<section class="launch-section demo-workbench" aria-labelledby="demo-form-h">
<form class="cell demo-form" action="/demo" method="get">
<label class="fol-label" id="demo-form-h" for="demo-work">Your work text</label>
<textarea class="field demo-textarea" id="demo-work" name="work" rows="7" spellcheck="true" placeholder="One artifact or accomplishment per line">${esc(
      input.work,
    )}</textarea>
<div class="demo-form-actions">
<button class="btn btn-primary" type="submit">${glyph("i-check", 16)}Preview</button>
<a class="btn btn-ghost" href="/demo">Clear</a>
</div>
<p class="aside">Public-safe text only · text goes in the URL</p>
</form>
${preview(input.work)}
</section>`, 2)}`,
  });
}
