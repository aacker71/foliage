/** Progress only. Native form submission still owns validation and all writes. */
for (const form of document.querySelectorAll('form[data-scarlet-conversation]')) {
  if (!(form instanceof HTMLFormElement)) continue;
  let pending = false;
  let progress;
  const buttons = Array.from(form.querySelectorAll('button'));
  const original = buttons.map(button => button.disabled);
  form.addEventListener('submit', event => {
    if (pending) { event.preventDefault(); return; }
    pending = true;
    const status = document.createElement('p');
    status.setAttribute('role', 'status');
    status.textContent = 'Working…';
    progress = status;
    form.append(status);
    for (const button of form.querySelectorAll('button')) button.disabled = true;
  });
  addEventListener('pageshow', () => { if (!pending) return; pending = false; progress?.remove(); buttons.forEach((button, index) => { button.disabled = original[index]; }); });
}

// Preserve links into collapsed settings, including keyboard navigation and back/forward.
function revealSettings() {
  const section = document.getElementById(location.hash.slice(1));
  if (section instanceof HTMLDetailsElement) { section.open = true; section.scrollIntoView(); }
}
addEventListener('hashchange', revealSettings);
revealSettings();

for (const form of document.querySelectorAll('form[data-journey-evidence]')) {
  if (!(form instanceof HTMLFormElement)) continue;
  const search = form.querySelector('[data-journey-evidence-search]');
  const count = form.querySelector('[data-journey-evidence-count]');
  const choices = Array.from(form.querySelectorAll('input[name="leaflet"]')).filter(input => input instanceof HTMLInputElement);
  if (!(search instanceof HTMLInputElement) || !count) continue;
  const update = () => {
    const selected = choices.filter(input => input.checked).length;
    count.textContent = `${selected} of 12 selected`;
    const query = search.value.trim().toLocaleLowerCase();
    for (const input of choices) {
      input.disabled = selected >= 12 && !input.checked;
      const row = input.closest('label');
      if (row) row.hidden = !!query && !input.checked && !row.textContent.toLocaleLowerCase().includes(query);
    }
  };
  search.addEventListener('input', update);
  form.addEventListener('change', update);
  update();
}
