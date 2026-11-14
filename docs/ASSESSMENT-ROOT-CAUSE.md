# Assessment rehearsal investigation — 2026-09-07

The earlier rehearsal identified refusals, not complete root causes. This
investigation traces the saved requests/responses through the real validator,
compares controlled local-model runs, and correlates the timeout with Ollama's
runtime log. No cloud request, original Leaf write or publication occurred.

## Confirmed causes and limits

### The prompt contradicted its own response contract

`apps/canopy/src/ladybugAssessment.ts` showed one finding whose dimension was the
literal string `novelty|impact|accuracy|scope|value|market` and whose citation source
was `evidence|knownWork|market`. Neither value is accepted by `parseFindings`.
The same prompt required six distinct findings. These contradictions existed in
the initial assessment implementation (`3e3428c`), before the revision bridge.

The first Llama answer copied both pipe-separated strings and repeated the root
`findings` key. Ordinary JSON parsing retained only the final repeated key, so
the visible refusal described the surviving invalid dimension. No answer was
accepted. Replaying the prompt's own example through the structural validator
deterministically produces `Unknown or repeated assessment dimension.`

Changing only the invalid example values made the model emit one valid `novelty`
finding, matching the single example. A complete six-finding template then
produced the six dimensions in order in the controlled structured-output run.
This supports an example-copying failure; it does not prove all future model
responses will obey the corrected template.

**Fix:** generate the complete structural template from the six allowed dimensions,
use valid citation-source values, and label placeholders as instructions rather
than evidence. Explicitly distinguish source fields from metadata and explain how
to cite actual work when comparison/market sources are missing. The exact corrected
prompt was compared byte-for-byte with the tested candidate.

**Regression:** the new test in `ladybugAssessment.test.ts` extracts the actual
model-facing example and checks it against the independent response validator and
the required dimension sequence. It failed on the original prompt and passes with
the correction. Earlier tests supplied well-formed protocol responses independently
of the prompt, so they did not detect this inconsistency.

### Citation refusal was correct; prompt-only repair did not solve model behavior

There was no lost source data or evidence-parser mismatch. The original saved
packets contained the selected evidence, while comparison and market fields were
empty. Replaying every returned citation against those exact fields established:

- Llama's structured response invented quotations attributed to the empty fields.
- Gemma's narrow response had four exact evidence quotations, but its scope quote
  came from `subject`, and its market quote was the invented `not available`.
- With clearer source rules and the complete template, Llama selected `evidence`
  but joined noncontiguous snippets with newlines and ellipses. Those constructed
  strings were not substrings of the evidence. Several observations also claimed
  implementation accuracy or impact that commit subjects do not establish.

The hypothesis that additional source instructions alone would fix fidelity was
falsified. The observed cause of refusal is invalid model-produced source/quote
pairs, not an overly strict validator. Why a model disregards these instructions
internally is not established by these experiments. Exact-citation checks, required
caveats, rating restrictions and the prohibition on automatic acceptance remain.

**Remaining work:** evaluate explicit selection of stored source references and
deterministic quotation retrieval, instead of asking models to rewrite quotation
text. Citation fidelity and whether an observation is supported are separate checks;
a real quotation can still accompany an unsupported conclusion. No such redesign
or successful live-model round trip is claimed in this investigation.

### The timeout was local computation, with interference in the original test setup

The production assessment's 90-second deadline also governed the injected local
transport. The original Gemma request began at 11:47:26 local time. Runtime logs
showed roughly 10.5 seconds to load, 27 seconds to process 4,077 prompt tokens, then
generation at approximately seven tokens per second. It had generated only 335
tokens near the cutoff. The request ended after about 90 seconds. There was no
Fireworks socket or billing response in that rehearsal.

The original test orchestration also ran `pnpm check` concurrently. Its
`apps/cos/src/localModel.test.ts` live completion test uses the same installed
Ollama service, asks the first installed model to reply `OK`, and requests a
different context size. The runtime log shows that small-model request during the
larger run, low free system memory, a scheduling/eviction message and the subsequent
small-model load. This confounds a clean latency benchmark. It does not establish
that memory pressure alone caused the timeout: the measured load, prompt and
generation times already consume the deadline.

**Correction:** live model experiments and the full repository suite now run
sequentially. The rehearsal saves the exact local request and available load,
prompt and generation timings. On timeout, absent final timings remain absent.
It records every per-finding validation failure rather than only the first. The
production timeout and provider boundary are unchanged.

## Controlled experiments

All prompt experiments used the same retained workflow evidence, `llama3.2:3b`,
temperature zero, a 16,384-token context and the original 90-second deadline.
These are individual observations, not a statistical model-quality benchmark.

| Intervention | Completion | Observed outcome |
| --- | --- | --- |
| Correct only pipe-separated example values; JSON mode | 17.2 s | One `novelty` finding; source citation still invalid |
| Add explicit source/metadata/missing-source rules; constrained JSON | 45.5 s | Six entries but repeated `value`, missing `market`; citation validation refused |
| Use complete valid template plus the same rules; constrained JSON | 27.7 s | Six ordered dimensions; all citations pointed at evidence, but their text was constructed rather than verbatim |
| Fresh committed prompt; ordinary JSON mode | 15.5 s | Only one finding and a nonmatching citation; refused. Load 1.39 s, prompt 8.39 s, generation 5.68 s; source unchanged |

The structural regression failed before the fix and the focused assessment suite
passed eight tests after it. After the fresh rehearsal finished, `pnpm check`
passed boundary, egress, duplication, findings, types and the full test suite:

```text
tests 1647
pass 1647
fail 0
skipped 0
duration_ms 106886.696167
```

Ordinary JSON mode guarantees neither six findings nor valid field choices. The
fresh run confirms that correcting the contradictory template does not by itself
fix model compliance. Constrained JSON improved structure in these experiments,
but did not establish citation fidelity. The production Fireworks request remains
on its existing JSON-object mode; provider-specific structured generation has not
been changed or verified while billing is unavailable.

## Related work

- `docs/LOCAL-REVISION-REHEARSAL.md` records the four original attempts.
- `docs/LEAFLET-REVISION-WORKFLOW.md` describes the independently tested revision
  and local acceptance operations.
- `TODOS.md`'s workflow-continuity entry covers the document handoff, not live model
  quality or cloud inference readiness.
- Prior project decision retained: Photosynthesis owns local AI; Ladybug is cloud-only.

Status: **DONE_WITH_CONCERNS**. The contradictory prompt is corrected and its
regression is covered. Citation fidelity, unsupported observations and Fireworks
runtime behavior remain outside any claim of successful live-model acceptance.
