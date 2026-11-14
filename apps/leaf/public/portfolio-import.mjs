const file = document.querySelector('#portfolio-file');
if (file) document.querySelector('.import-upload')?.removeAttribute('hidden');
file?.addEventListener('change', async () => {
  const selected = file.files?.[0];
  const status = document.querySelector('#import-file-status');
  const filename = document.querySelector('#import-file-name');
  if (!selected) { filename.textContent = 'No file chosen'; status.textContent = ''; return; }
  filename.textContent = selected.name;
  if (!/\.(txt|md|markdown)$/i.test(selected.name) || selected.size > 400000) {
    status.textContent = 'Text or Markdown · Maximum 400 KB';
    return;
  }
  try {
    const text = new TextDecoder('utf-8', {fatal:true}).decode(await selected.arrayBuffer());
    if (text.length > 100000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) throw new Error('unsupported');
    document.querySelector('#import-text').value = text;
    document.querySelector('#import-source').value = selected.name;
    if (!document.querySelector('#import-title').value) document.querySelector('#import-title').value = selected.name.replace(/\.(txt|md|markdown)$/i, '');
    status.textContent = 'Opened locally';
    document.querySelector('.portfolio-import-form button[type=submit]')?.focus();
  } catch { status.textContent = 'Unreadable file · UTF-8 required'; }
});

// A submitted preview or validation result receives focus, including below the form on phones.
const response = document.getElementById('import-response');
if (response) { response.focus({preventScroll:true}); response.scrollIntoView({block:'start',behavior:'instant'}); }
