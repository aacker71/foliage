# Workflow first use — 5 October 2026

Source: `apps/leaf/workflow-ui/app.tsx` on the `codex/pilot-screen-integration-20261001` integration branch. The screenshots show an isolated local Workflow with no Leaf, harvest, or connected source; they do not depict a completed collection.

- [Phone, 375 × 812](screenshots/2026-10-05-workflow-first-use-375.jpg)
- [Desktop, 1280 × 900](screenshots/2026-10-05-workflow-first-use-1280.jpg)

The empty Overview has one action, **Connect a source**. In the live browser, activating it set `#sources`, selected the Sources tab, and revealed the source search. The page header no longer repeats the `/review` destination above the Overview's own Review action when drafts exist; Review remains in the shared workspace navigation.

Gstack `/browse` opened one owned Aside tab for the interaction and closed it. Aside's emulated screenshot output tiled across its fixed surface despite `innerWidth` matching 375 and 1280, so the saved screenshots were captured in one owned gstack Chromium tab at native viewports. Their pixel dimensions were checked before inclusion, and that tab was closed. The Aside tab reported no page errors.

The Workflow bundle, Leaf typecheck, focused Workflow shell and transport tests (2/2), and the Impeccable source detector (`[]`) passed. Connected-source setup, an active draft queue, and background collection were not exercised by this first-use receipt.
