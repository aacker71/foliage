# Hosted Canopy production gate · 6 October 2026

The public website and its local-app archive are live. Hosted Canopy is not
activated. Its production `/manage` response is the intentional 503 refusal:
“Hosted service configuration is unavailable. No local publication fallback is
enabled.” A Ready Vercel deployment does not change that result.

## Observed configuration

- The `foliage-canopy` Vercel project's Production environment lists only
  `CLERK_SECRET_KEY` and `SUPABASE_URL`. The hosted entry also requires
  `FOLIAGE_APP_ORIGIN`, `CLERK_PUBLISHABLE_KEY` and
  `SUPABASE_SERVICE_ROLE_KEY`. Values were not read or recorded.
- The Supabase account lists one healthy Foliage project,
  `foliage-canopy-preview` in `us-east-1`. No separate active Canopy Production
  project is listed. The inactive Coeadapt and Foliage Brain projects are not
  substitutes for a selected production authority.
- Vercel Preview deploys build, but the generated preview hostname does not
  satisfy the exact-origin Clerk setting. Production account, database and
  publication acceptance have not been performed.
- `getfoliage.com` keeps hosted sign-in hidden because
  `FOLIAGE_HOSTED_ACCEPTED` is unset.

## Activation sequence

1. Select or create a **separate Production** Supabase project and Clerk
   application/instance. Record their region, operator and recovery plan.
   Do not copy Preview keys or data into Production.
2. Apply `supabase/migrations` to that project in order. Confirm the
   `foliage-publications` bucket is private and service-only, and exercise
   the live RPC, role and storage restrictions.
3. Set the five required Canopy Production settings for the selected projects
   and one exact HTTPS `FOLIAGE_APP_ORIGIN`. Leave all `NOVU_*` settings unset
   until its Clerk contact adapter exists. Deploy the reviewed Canopy build.
4. Rehearse with two distinct real accounts: sign-in and account separation;
   reviewed publication and exact-version replacement; anonymous HTML, JSON,
   photo and MCP reads; withdrawal through current and old deployment URLs;
   retries, recovery and revocation continuity. Verify an outside-reader path.
5. Only after that record is accepted, set the website's
   `FOLIAGE_HOSTED_ORIGIN` and `FOLIAGE_HOSTED_ACCEPTED=1`, deploy the website
   and check the live sign-in link. Keep the local archive independently usable.

The concrete release contract is
[`context/contracts/deployment-and-service.md`](../../context/contracts/deployment-and-service.md).
This document records a blocked activation, not a successful hosted launch.
