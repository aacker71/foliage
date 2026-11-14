/** Presentation only. No provider requests, tracking or automatic printing. */
const print = document.querySelector('[data-resume-print]');
if (print instanceof HTMLButtonElement) {
  print.hidden = false;
  print.addEventListener('click', async () => {
    print.disabled = true;
    const status = document.querySelector('#resume-print-status');
    try {
      await document.fonts.ready;
      window.print();
    } catch {
      if (status) status.textContent = 'Use your browser’s Print command to save this résumé as a PDF.';
    } finally {
      print.disabled = false;
    }
  });
}
