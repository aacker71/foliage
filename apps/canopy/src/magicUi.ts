export type BlurFadeStep = 0 | 1 | 2 | 3;

// Magic UI's Blur Fade primitive adapted for Canopy's no-JavaScript,
// server-rendered public pages.
export function blurFade(markup: string, step: BlurFadeStep = 0): string {
  return `<div class="magic-blur-fade" data-magic-step="${step}">${markup}</div>`;
}
