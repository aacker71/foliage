# Foliage

TypeScript run directly by Node ≥22.18 (type stripping, no build step); pnpm workspace.

```bash
pnpm install
pnpm check                      # the full gate — green before every commit
node foliage.mjs up             # run the local app
```

## Rules

- No fake data. No score anywhere an employer sees; tiers `verified/pending/excluded` are unordered, and `excluded` always carries a reason.
- `open` packages never import `cloud` or `enterprise` (`pnpm check:boundary`).
- Pure logic in `packages/*`; effects (fs, env, clock, network) live in `apps/*`.
- Repo is private. Small PRs; never force-push; never commit through a red gate.
- Ports 4173–4199 are taken by long-running servers; bind 4210+.
- Never invent UI components. Every component comes directly from a component library that a human made: shadcn/ui (new-york-v4, from its registry) and the Radix primitives it builds on. Server-rendered markup reproduces the library component's own recipe, generated from its vendored source, never a hand-written look-alike. If the library has nothing for the need, compose library components or ask the owner; never design a new one.
