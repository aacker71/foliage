# Local Canopy publication and public-brain rehearsal — 2026-09-30

This was a bounded **local** rehearsal with an isolated copy of the founder's captured
Foliage garden, not a hosted-account or deployed HTTPS acceptance. The source files were
copied to `/tmp/foliage-canopy-pilot.DX7Is9`; the owner's garden was not edited. The
copied Leaf had 847 real git Leaflets, all pending-tier, and the separate harvest had
201 unreviewed candidates. An exact evidence-ref rule and explicit public share in the
copy selected one Leaflet: `git:f81fd1682874c644eaab059c97fe2e07feda859d`.

The commands run from the repository were:

```sh
PILOT=/tmp/foliage-canopy-pilot.DX7Is9
REF=git:f81fd1682874c644eaab059c97fe2e07feda859d
node apps/leaf/policy.mjs allow "$REF" --by evidence-ref \
  --because 'One-record local publication rehearsal' \
  --leaf "$PILOT/leaf.json" --policy "$PILOT/policy.json"
node apps/leaf/share.mjs share "$REF" --as public --leaf "$PILOT/leaf.json"
node apps/canopy/publish.mjs --document "$PILOT/leaf.json" \
  --into "$PILOT/published" --policy "$PILOT/policy.json" --brief
node apps/canopy/publish.mjs --document "$PILOT/leaf.json" \
  --into "$PILOT/published" --policy "$PILOT/policy.json" \
  --expect-digest sha256:2a3d86e5b41f899f297d4b0e20864818ef516ffcf2dd6523f306959ae6b2bdf7 \
  --expect-policy-digest sha256:d7552386b850179aec61084aa97c26b8d643ce1f38f1a684fede1e1965b66098 \
  > "$PILOT/review.txt"
node apps/canopy/publish.mjs --document "$PILOT/leaf.json" \
  --into "$PILOT/published" --policy "$PILOT/policy.json" \
  --expect-digest sha256:2a3d86e5b41f899f297d4b0e20864818ef516ffcf2dd6523f306959ae6b2bdf7 \
  --expect-policy-digest sha256:d7552386b850179aec61084aa97c26b8d643ce1f38f1a684fede1e1965b66098 \
  --confirm alex-a > "$PILOT/publish.txt"
```

The complete non-confirming review reported **one pending-tier Leaflet to publish and
846 withheld as not shared**, exited 3, and wrote no publication directory. The
digest-bound confirmation wrote one format-5 artifact (975 bytes) for `/leaf/alex-a`.
The artifact contained only the selected Leaflet. The unreviewed harvest candidate
`git-cluster:C1` was not in it.

The production `createHostedApp` handlers read that artifact through
`loadPublishedLeaf` from the isolated directory. `GET /leaf/alex-a` returned 200 with
the selected title and a `/leaf/alex-a/mcp` pointer. `GET
/leaf/alex-a/search.json?q=reader%20scenes` returned 200 with the selected title,
its citation and no score. A query using the unreviewed candidate's identifier
returned only the admitted published record, with none of the candidate's content.
An official MCP SDK client connected to the loopback `POST /leaf/alex-a/mcp`, listed
only `foliage_search_published`, and received the same cited published record from
its tool call. No owner identity route was used by these public reads.

The withdrawal harness computed `artifactDigest = documentDigest(await
readFile(publishedPath("$PILOT/published", "alex-a")))` from the current artifact,
then invoked `node apps/canopy/withdraw.mjs --from "$PILOT/published" --id
alex-a --expect-digest "$artifactDigest" --confirm alex-a`. It succeeded.
The same HTML, search and MCP routes all returned **404** immediately afterward.
The copied Leaf and harvest byte digests were unchanged by reading and withdrawal.

The hosted handlers were called in process under a test HTTPS origin; the MCP SDK
exchange used a real loopback HTTP listener. This receipt does not establish a live
Vercel route, Clerk account isolation, CDN withdrawal, or two-account acceptance.
Those still need a configured external host and independent live checks.
