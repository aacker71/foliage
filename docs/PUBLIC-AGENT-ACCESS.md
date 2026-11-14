# Public agent access on Canopy

People and automated readers can read an owner-published portfolio without signing in.
`/leaf/:id/agent.json` describes the current publication and links to its human portfolio,
structured résumé, Markdown and Word exports. The public HTML links to this descriptor
with `rel="describedby"`. When configured, the descriptor also advertises evidence search
and the existing read-only MCP interface. It does not enumerate other portfolios.

The descriptor uses current publication authority, is uncached, and becomes unavailable
on withdrawal. It exposes no private record or additional career content. Readers must
preserve citations and attribution qualifications. Public reading grants no write action,
contact permission, directory listing or partner/destination delivery permission. Those
remain separate owner-controlled actions. External downloaded copies cannot be recalled.

This is a Foliage-specific interface, not a claim of an industry-standard agent manifest.
It does not change robots indexing policy or authorize access to third-party platforms.
This implementation requires deployment before it is available on the hosted service.
