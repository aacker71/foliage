/** Served only on private account/workspace HTML. Public readers never load Clerk. */
export const clerkBrowserScript = `
(async () => {
  const config = document.querySelector('meta[name="foliage-clerk"]');
  const status = document.getElementById('account-status');
  const fail = () => { if (status) status.textContent = 'Sign-in unavailable · reload'; };
  if (!config) return;
  const script = document.createElement('script');
  script.src = config.dataset.issuer + '/npm/@clerk/clerk-js@6.32.1/dist/clerk.browser.js';
  script.dataset.clerkPublishableKey = config.content;
  script.crossOrigin = 'anonymous';
  const loaded = new Promise((resolve, reject) => { script.onload = resolve; script.onerror = reject; });
  document.head.append(script);
  try {
    await loaded;
    const target = document.getElementById('clerk-account');
    const account = document.getElementById('clerk-user');
    if (target || account) {
      const ui = document.createElement('script');
      ui.src = config.dataset.issuer + '/npm/@clerk/ui@1.33.1/dist/ui.browser.js';
      ui.crossOrigin = 'anonymous';
      const ready = new Promise((resolve, reject) => { ui.onload = resolve; ui.onerror = reject; });
      document.head.append(ui);
      await ready;
    }
    await window.Clerk.load({ afterSignOutUrl: '/auth/sign-in', telemetry: { disabled: true }, localization: { signIn: { start: { title: 'Sign in to Foliage' } }, signUp: { start: { title: 'Create your Foliage account' } } }, ...((target || account) ? { ui: { ClerkUI: window.__internal_ClerkUICtor } } : {}) });
    if (config.dataset.signedOut === 'true') {
      if (window.Clerk.session) await window.Clerk.signOut({ redirectUrl: '/auth/sign-in' });
      else window.location.replace('/auth/sign-in');
      return;
    }
    if (account && window.Clerk.session) window.Clerk.mountUserButton(account, { showName: true, userProfileMode: 'modal', appearance: { elements: { userButtonPopoverCard: { boxShadow: 'none' }, card: { boxShadow: 'none' } } } });
    if (!target) return; // Clerk keeps the short-lived private session cookie fresh.
    const destination = config.dataset.returnTo || '/manage';
    if (window.Clerk.session) { window.location.replace(destination); return; }
    if (status) status.textContent = '';
    const options = { routing: 'hash', signInUrl: '/auth/sign-in', signUpUrl: '/auth/sign-up',
      forceRedirectUrl: destination, signInForceRedirectUrl: destination, signUpForceRedirectUrl: destination };
    if (location.pathname === '/auth/sign-up') window.Clerk.mountSignUp(target, options);
    else window.Clerk.mountSignIn(target, options);
  } catch { fail(); }
})();
`;
