import "./media-status.mjs";
/** Local preset preview. It never reads evidence, saves data or loads a network resource. */
const preview = document.querySelector('[data-presentation-preview]');
const typography = document.querySelector('#typography');
const spacing = document.querySelector('#spacing');
const palette = document.querySelector('#palette');
const layout = document.querySelector('#layout');
const hero = document.querySelector('#hero');
const media = document.querySelector('#media');

if (preview instanceof HTMLElement && typography instanceof HTMLSelectElement && spacing instanceof HTMLSelectElement && palette instanceof HTMLSelectElement && layout instanceof HTMLSelectElement && hero instanceof HTMLSelectElement && media instanceof HTMLSelectElement) {
  const update = () => {
    preview.dataset.readingTypography = typography.value || preview.dataset.inheritedTypography || 'editorial';
    preview.dataset.readingSpacing = spacing.value || preview.dataset.inheritedSpacing || 'airy';
    preview.dataset.readingPalette = palette.value || preview.dataset.inheritedPalette || 'source';
    preview.dataset.readingLayout = layout.value || preview.dataset.inheritedLayout || 'branching';
    preview.dataset.readingHero = hero.value || preview.dataset.inheritedHero || 'split';
    preview.dataset.readingMedia = media.value || preview.dataset.inheritedMedia || 'contained';
    const personHero = preview.querySelector('.lp-person-hero');
    if (personHero instanceof HTMLElement) personHero.dataset.personComposition = preview.dataset.readingHero;
    const record = preview.querySelector('.lp-record');
    if (record instanceof HTMLElement) {
      record.dataset.readingPalette = preview.dataset.readingPalette;
      record.dataset.readingLayout = preview.dataset.readingLayout;
      record.dataset.readingMedia = preview.dataset.readingMedia;
    }
  };
  for (const control of [typography, spacing, palette, layout, hero, media]) control.addEventListener('change', update);
  update();
}
