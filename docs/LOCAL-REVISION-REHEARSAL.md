# Test the revision journey while cloud billing is unavailable

`pnpm ai:rehearse` is an opt-in engineering command that uses an installed Ollama
model to exercise the assessment and revision contracts. Ladybug's production
provider stays Fireworks and its cloud-only boundary is unchanged. This command
does not configure a local Ladybug product or silently fall back from cloud.

```sh
pnpm ai:rehearse --leaf /absolute/path/to/leaf.json \
  --leaflet 'selected-pending-private-leaflet-id' \
  --model 'gemma4:12b' \
  --title 'Wording you reviewed against the evidence'
```

Without `--run`, this validates the real selected Leaflet export and prints a
preflight summary. Add `--run` to call local Ollama and create a new private
temporary directory. The original Leaf is never written. No credential is needed.
Add `--structured` to constrain Ollama's JSON decoding to the assessment field
names, dimension/source enums and six-finding array. This is an explicit test
variant; the prompt and production validators remain unchanged. It does not
repair quotations or establish the truth of model observations.

The command sends the unchanged Ladybug assessment prompt and selected, redacted
packet to `127.0.0.1:11434/api/chat`. Only the transport is adapted through the
existing injected-fetch test seam: actual Ollama completion text is wrapped in the
response envelope consumed by the production parser. The placeholder credential
and provider-approval value exist only in this test invocation and are never sent
or persisted. The production endpoint and refusal gates are not changed.

Accepted output must satisfy the existing six-dimension, exact-citation, mandatory
caveat, privacy, no-rating and completion checks. Rejected output is not repaired
or substituted. An accepted assessment is exported with the explicitly supplied
reviewed title, previewed, and accepted into the copied Leaf using the ordinary
local revision functions. Assertions check original evidence, proof, visibility,
unrelated Leaflets and count, then prove a stale replay cannot write again.

The printed output directory contains private request, model completion (without
the reasoning channel), assessment, return packet, preview HTML, copied Leaf and
`report.json`. The report records the actual model, target revision, call count,
completion reason, available token counts, timing, checks and failure reason.
Failure exits nonzero. No retries happen automatically.

This establishes local-model compatibility and the connected document workflow.
It does not establish Fireworks authentication, billing, hosted availability,
cloud-model quality, provider retention guarantees or production account isolation.

## Live rehearsal — 2026-09-07

The input was the existing pending/private workflow Leaflet from the isolated
repository rehearsal: 25 retained commit references, 242 declared omissions,
7,510 evidence characters after import. Comparison and market material were empty.
The proposed return title was reviewed against the first retained commit subject.

| Model and mode | Observed result |
| --- | --- |
| `gemma4:12b`, JSON mode | Reached the existing 90-second assessment timeout; no output accepted or revision written |
| `llama3.2:3b`, JSON mode | Completed in 43.7 seconds, with 3,447 input and 1,199 output tokens; refused for invalid dimension fields. It copied pipe-separated alternatives literally, repeated root keys, and made unsupported claims from commit subjects |
| `llama3.2:3b`, constrained JSON schema | Completed in 14.7 seconds, with 3,447 input and 514 output tokens; shape improved, but invented quotations attributed to empty comparison/market fields were refused |
| `gemma4:12b`, constrained schema, narrower mark Leaflet | Two real commit references; completed in 72.0 seconds with 853 input and 547 output tokens. Refused because quotations referenced text outside evidence and an empty market field (`not available` was not a source quotation) |

These failures remained in isolated reports and left the source document unchanged.
Passing a transport/format gate is not an assessment-quality verdict.
No live-model attempt reached the export/acceptance stage. Those revision operations
remain covered by the existing deterministic integration tests; this rehearsal does
not relabel them as a successful live-model round trip. Final `pnpm check` passed
all 1,646 tests and the boundary, egress, duplication, findings and type gates.
