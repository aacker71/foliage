/** Discovery sends no portfolio data. Only the paired service can answer this origin. */
export const photosynthesisBrowserScript = `
(() => {
  const button = document.getElementById('connect-photosynthesis');
  const status = document.getElementById('photosynthesis-status');
  if (!button || !status) return;
  button.addEventListener('click', async () => {
    button.disabled = true;
    status.textContent = 'Finding Photosynthesis…';
    try {
      const response = await fetch('http://127.0.0.1:4180/onboarding/status', { mode: 'cors', credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(4000) });
      if (!response.ok) throw new Error();
      const service = await response.json();
      if (service.service !== 'foliage-photosynthesis' || service.version !== 1 || service.canopyOrigin !== location.origin) throw new Error();
      status.textContent = 'Opening Photosynthesis…';
      location.assign('http://127.0.0.1:4180/hosted');
    } catch {
      status.textContent = 'Photosynthesis unreachable. Open it on this computer, then retry. Local network access may be needed.';
      button.textContent = 'Try again';
      button.disabled = false;
    }
  });
})();
`;
