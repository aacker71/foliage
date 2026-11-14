> Scope and implementation status: [canonical architecture](../context/architecture.md).
> This document retains its dated decisions or detailed feature contract; it is not a second application inventory.

# The agent ecology — naming, hierarchy, runtime

Owner spec, 2026-08-29 (agent naming & hierarchy design spec; runtime directive added
same day). Agent naming revised by the owner on
2026-09-10. The naming scheme is tree-and-foliage protection ecology: each
agent tier is a real caretaker whose scope mirrors the layer it protects — and each tier
maps one-to-one onto the portfolio taxonomy it serves.

## The four tiers

```
PANGO      forest                 ↔  CANOPY    forest protection, Canopy maintenance
  PICUS      organization         ↔  TREE      deep inspection, structural remediation
    DEE DEE    team               ↔  BRANCH    always-active, high-volume coordination
      SCARLET    individual       ↔  LEAF      one user, one task — the universal agent
```

Pango is the forest-protecting agent that maintains the Canopy. In that role, Pango
coordinates Picus instances across the forest;
each Picus oversees the Dee Dee agents within its organization; each Dee Dee dispatches and
manages Scarlet agents across its team.

| Tier | Codename | Scope | Behavior model | Why the name |
|---|---|---|---|---|
| 1 — Individual | **Scarlet** | single user / single task | general-purpose, on-demand | Scarlet is the ladybug agent, doing hands-on work at the smallest unit of scope. One universal identity, deliberately not split into sub-roles. |
| 2 — Team | **Dee Dee** | team / shared workspace | high-volume, continuous, always-active | The owner chose the swallow as the team-tier identity for Dee Dee: continuous coordination across a wide, shifting set of instances. |
| 3 — Organization | **Picus** | org-wide | deep inspection, structural remediation | The woodpecker inspires inspection beneath the surface: deeper, systemic problems across many teams. |
| 4 — Forest / Canopy | **Pango** | forest-wide / Canopy | forest protection, Canopy maintenance | The owner chose the pangolin as the forest-protecting agent that maintains the Canopy. |

## Named function specialists

- **Fern** — the enterprise onboarding and policy-management agent (owner, 2026-08-29).
  Operates at the organization layer alongside Picus: walks a company's decision makers
  through declaring the policy object, collects the right signatures (accounting for key
  decision makers, applicable law — see the employment-consent framework — and company
  strategy), and installs the rules where the mechanical gates enforce them. Fern manages
  governance; Picus inspects health. Future sub-roles at any tier draw from the same
  ecological theme (related species and ecological processes) to stay consistent.
- **Photosynthesis** remains the product's one verb, not an agent name: it is the capture
  process Scarlet performs for its person — material in, leaflet candidate out, nothing
  enters a leaf unapproved.

## Runtime strategy (owner, 2026-08-29)

Two sanctioned runtimes, chosen per deployment:

1. **Fireworks (default for confidentiality)** — the agents run on Fireworks-hosted
   inference so an organization's material stays within controlled infrastructure.
2. **Bring-your-own AI (opt-in, lower upfront cost)** — a user or org may opt into their
   existing AI services instead.
3. **Enterprise providers (enterprise plane)** — for enterprise deployments, integration
   with AWS Bedrock and the other major providers enterprises and businesses already use
   (e.g. Azure-hosted models, Google Vertex), so the agents run inside the customer's
   existing cloud agreements, compliance envelopes, and negotiated pricing.

**Deployment form factor (owner, 2026-08-29): on-prem or cloud.** An enterprise runs the
stack either in the cloud or fully on-premises — self-hosted inside its own
infrastructure, where the agents call on-prem inference and nothing leaves the building.
The deploy artifact is already the source tree plus pinned Node (no build step), which is
what makes the on-prem form factor honest rather than aspirational.

Which runtimes an organization permits is a **policy-object decision** — declared during
Fern's onboarding, printed where it applies, enforced mechanically like every other
policy. An individual's choice never silently overrides their org's declared policy.

## Naming and marketing usage

Owner decision, 2026-09-10: replace the former conservationist namesake because of
his racism. **Pango** is the forest-protecting pangolin agent that maintains the Canopy.
**Picus** is the woodpecker agent at the organization tier. **Dee Dee** is the swallow agent at the team tier.
**Scarlet** is the ladybug agent at the individual tier.
Use `pango`, `picus`, `dee-dee`, and `scarlet` for the proposed namespaces. The owner's attached
pangolin photograph is visual reference for the animal, not a replacement for Foliage's
bipinnate compound-leaf mark. This rename preserves the role's scope and permission
boundaries: coordination across companies requires explicit grants; hierarchy conveys
no access rights.

- Codenames are proper nouns in logs, dashboards, docs, and marketing copy
  ("Picus flagged an anomaly in 3 Dee Dee instances").
- Customer-facing surfaces never abbreviate codenames without approval; internal
  shorthand (`Scarlet-01`, `Dee-Dee-03`) is acceptable in logs and IDs.
- Each name refers only to its tier — never reused for unrelated systems.
- Marketing tells the story the names already carry: every tier of the ecology protects
  the level of the portfolio it is named for — ladybugs on the leaves, swallows around the
  branches, woodpeckers on the trees, Pango protecting the forest and maintaining the Canopy. Plain human words, per
  the house copy law.

## Open items for engineering (from the spec + runtime directive)

- Confirm whether Scarlet stays one universal role or later splits by task category.
- Define the escalation path: what conditions surface a Scarlet issue up to Dee Dee,
  Picus, or Pango.
- Confirm ID/namespace conventions (e.g. `pango.<org>.picus.<team>.dee-dee.<n>.scarlet.<n>`)
  for logging and tracing.
- Runtime: which models run on Fireworks, data-residency guarantees per tier, and how the
  policy object expresses a BYO-AI allowance (org-wide, per-team, or per-person).
