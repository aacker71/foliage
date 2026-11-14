import "./media-status.mjs";
/** Live reading of saved local work. Collection and publication still have their own controls. */
let portfolio = document.querySelector('#personal-portfolio');
const status = document.querySelector('#portfolio-sync');
if (portfolio && status) {
  const resumeView = portfolio.dataset.readingView === 'resume';
  const statePath = resumeView ? '/leaf/resume-state' : '/leaf/portfolio-state';
  let revision = portfolio.dataset.portfolioRevision;
  let policyRevision = portfolio.dataset.policyRevision ?? '';
  let workDatesRevision = portfolio.dataset.workDatesRevision ?? '';
  let freshnessRevision = document.querySelector('#portfolio-freshness')?.dataset.revision ?? '';
  let busy = false, stopped = false, timer;
  const openKeys = root => [...root.querySelectorAll('details[open]')].map(node => node.id).filter(Boolean);
  async function refresh() {
    if (busy || stopped || document.hidden) return;
    busy = true;
    try {
      const params = new URLSearchParams({ revision, policyRevision, freshnessRevision, workDatesRevision, order: portfolio.dataset.portfolioOrder ?? 'notable', collection: portfolio.dataset.portfolioCollection ?? '', records: portfolio.dataset.portfolioRecordsMode === 'source' ? 'source' : '', page: portfolio.dataset.portfolioPage ?? '1' });
      const response = await fetch(`${statePath}?${params}`, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10000) });
      if (response.status === 204) { status.textContent = 'Up to date'; return; }
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'The saved portfolio could not be read.');
      if (typeof payload.revision !== 'string' || typeof payload.policyRevision !== 'string' || typeof payload.workDatesRevision !== 'string' || typeof payload.freshnessRevision !== 'string' || typeof payload.freshnessHtml !== 'string') throw new Error('The refreshed portfolio was incomplete.');
      if (payload.revision !== revision || payload.policyRevision !== policyRevision || payload.workDatesRevision !== workDatesRevision) {
        const next = new DOMParser().parseFromString(payload.html, 'text/html').querySelector('#personal-portfolio');
        if (!next || next.dataset.portfolioRevision !== payload.revision || next.dataset.policyRevision !== payload.policyRevision || next.dataset.workDatesRevision !== payload.workDatesRevision) throw new Error('Refresh mismatch');
        // Native details and links keep working without JavaScript. Restore the reader's context.
        const opened = openKeys(portfolio);
        const active = portfolio.contains(document.activeElement) ? document.activeElement : null;
        const focused = active instanceof HTMLAnchorElement ? active.getAttribute('href') : null;
        const focusedSummary = active?.tagName === 'SUMMARY' && active.parentElement instanceof HTMLDetailsElement ? active.parentElement.id : null;
        const focusedControl = active instanceof HTMLSelectElement || active instanceof HTMLButtonElement ? active.id : null;
        const anchor = [...portfolio.querySelectorAll('[data-record-id]')].find(node => {
          const bounds = node.getBoundingClientRect();
          return bounds.top < innerHeight && bounds.bottom > 0;
        });
        const anchorId = anchor?.dataset.recordId, anchorTop = anchor?.getBoundingClientRect().top;
        next.dataset.portfolioActiveId = portfolio.dataset.portfolioActiveId ?? '';
        next.dataset.portfolioMotion = portfolio.dataset.portfolioMotion ?? '';
        document.dispatchEvent(new CustomEvent('foliage:portfolio-before-refresh', { detail: { root: portfolio } }));
        portfolio.replaceWith(next); portfolio = next;
        for (const id of opened) { const node = document.getElementById(id); if (node instanceof HTMLDetailsElement) node.open = true; }
        if (focused) [...portfolio.querySelectorAll('a')].find(a => a.getAttribute('href') === focused)?.focus({ preventScroll: true });
        if (focusedSummary) document.getElementById(focusedSummary)?.querySelector(':scope > summary')?.focus({ preventScroll: true });
        if (focusedControl) document.getElementById(focusedControl)?.focus({ preventScroll: true });
        document.dispatchEvent(new CustomEvent('foliage:portfolio-refresh', { detail: { root: portfolio } }));
        const url = new URL(location.href);
        if (url.searchParams.has('page') && url.searchParams.get('page') !== portfolio.dataset.portfolioPage) {
          if (portfolio.dataset.portfolioPage === '1') url.searchParams.delete('page');
          else url.searchParams.set('page', portfolio.dataset.portfolioPage);
          history.replaceState(null, '', url);
        }
        const replacement = [...portfolio.querySelectorAll('[data-record-id]')].find(node => node.dataset.recordId === anchorId);
        if (replacement && anchorTop !== undefined) scrollBy(0, replacement.getBoundingClientRect().top - anchorTop);
        revision = payload.revision;
        policyRevision = payload.policyRevision;
        workDatesRevision = payload.workDatesRevision;
      }
      const freshness = document.querySelector('#portfolio-freshness');
      if (freshness) {
        const next = new DOMParser().parseFromString(payload.freshnessHtml, 'text/html');
        freshness.replaceChildren(...next.body.childNodes); freshness.dataset.revision = payload.freshnessRevision;
      }
      freshnessRevision = payload.freshnessRevision;
      status.textContent = 'Updated';
    } catch (error) {
      status.textContent = `Update failed: ${error.message}`;
    } finally { busy = false; }
  }
  function schedule() { clearTimeout(timer); timer = setTimeout(async () => { await refresh(); if (!stopped) schedule(); }, document.hidden ? 30000 : 5000); }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); schedule(); });
  window.addEventListener('pagehide', () => { stopped = true; clearTimeout(timer); });
  window.addEventListener('pageshow', () => { stopped = false; refresh(); schedule(); });
  schedule();
}
