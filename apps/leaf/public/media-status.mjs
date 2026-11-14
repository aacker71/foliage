/** Failed local image requests remain visible and recover on a subsequent load. */
function showState(image, failed) {
  if (!(image instanceof HTMLImageElement)) return;
  const figure = image.closest('[data-media="shown"]');
  const message = figure?.querySelector('[data-media-unavailable]');
  if (!message) return;
  image.hidden = failed;
  message.hidden = !failed;
}
document.addEventListener('error', event => showState(event.target, true), true);
document.addEventListener('load', event => showState(event.target, false), true);
function scan() {
  document.querySelectorAll('[data-media="shown"] img').forEach(image => {
    if (image.complete) showState(image, image.naturalWidth === 0);
  });
}
scan();
document.addEventListener('foliage:portfolio-refresh', scan);
