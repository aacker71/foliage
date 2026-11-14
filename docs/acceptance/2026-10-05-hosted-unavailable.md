# Hosted Canopy unavailable state · 5 October 2026

The hosted runtime was started locally with Clerk and Supabase settings absent. `/manage`, `/recruiting` and `/auth/sign-in` correctly returned 503 and made no local publication fallback. Browser navigation now receives a minimal, night-face recovery page; machine requests continue to receive plain text. Missing setting names remain in bounded server diagnostics, not in the page.

The browser page loaded its six stylesheets, mark and fonts from the same local origin. At measured 375 and 1280 CSS-pixel viewports it had no horizontal overflow, console errors or external resources. Tab visibly focused the same-origin Retry link. [Phone capture](screenshots/2026-10-05-hosted-unavailable-375.jpg) · [Desktop capture](screenshots/2026-10-05-hosted-unavailable-1280.jpg). The captures show keyboard focus. A focused HTTP test covers HTML 503, local token CSS 200, plain machine response 503 and a `/api/` path that stays plain even when it advertises HTML.

This accepts only the unconfigured failure presentation. Authenticated management, recruiting, account separation and hosted publication still require a configured deployment and real-user acceptance.
