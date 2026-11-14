# Local Dify acceptance — 2026-09-06

Installed Dify 1.17.0 at its pinned upstream commit on the owner's macOS Docker Desktop host.
The local app is `1938cb4b-9837-426e-8521-dc36059f4ac4` at <http://127.0.0.1:4280>.
Browser inspection confirmed the five-node editor, Logs table, successful runs and failed-run details.
No deployment or external model-provider call was performed.

## Product-boundary correction

The owner subsequently clarified that Photosynthesis owns local AI and Ladybug is cloud-only.
The local Dify lab and agent UI are now named Photosynthesis. The run records below retain
the names used when those runs occurred; they are historical local-agent evidence, not
evidence that the Ladybug cloud product has been tested locally.

## Evidence

The live input was an owner-saved workflow rehearsal packet from the repository: 25 retained
commit subjects and 242 omitted matching commits. Its legacy capture time is unknown.
The packet itself and all credentials remain outside Git in the private local state directory.

| Run | Observed outcome |
| --- | --- |
| `3ddffd8e-48e3-4e14-8c53-6c3be3d4bb8e` | Ollama reached the original 400-token cap. The response-validation node failed; no successful evaluation was asserted. |
| `09a98da9-bf6d-4c25-9d59-bb3386077ad2` | Complete local `llama3.2:3b` response; all five nodes succeeded; existing Ladybug contract checks passed. 1,725 input / 456 output tokens; CLI duration 12,053 ms. Human inspection found the answer too list-heavy. |
| `7f4e6243-6dae-459b-822d-31f89597e74b` | Revised prompt; five nodes succeeded; contract checks passed. 1,770 input / 240 output tokens; CLI duration 34,064 ms. It grouped subjects into three themes. |
| `539318ba-a90e-480c-98b5-e9b67e05ba45` | Deliberately selected an uninstalled model. Ollama returned 404; Dify failed the run and the CLI exited nonzero in 342 ms. |

The revised run's immutable workflow id is `e815310c-0098-43c1-bf1c-6376542e49da`.
Its source DSL digest is `381e919329672e04e89835fb592bdee2b8a23b82bac5c6b5a2b83b3dd649c46d`.
These are observations from individual runs, not a latency benchmark; the repository test suite
was running concurrently during the revised run.

## Human review found a remaining model limitation

The revised answer did not state the known omitted-commit count and expanded its limitations
into unsupported claims about omitted emails/notes. The existing deterministic checks did not
flag those semantic errors. **The model output is not approved for publication.** This is a
concrete next evaluation case: faithful treatment of omitted evidence and observation time.
Passing citation syntax checks is not a truth or production-readiness claim.

## Infrastructure and code checks

- Resolved Compose configuration publishes only `127.0.0.1:4280`; plugin debug ports are absent.
- The code sandbox attaches only to an internal Docker network, with blank HTTP/HTTPS proxies.
- `pnpm ai:up` waits for Compose readiness. Browser login and the workflow editor were exercised.
- Service secrets and account/API credentials are generated outside Git; the parent state
  directory is mode 0700 and credential files are mode 0600.
- Both application Ladybug request paths use the same content-free diagnostic wrapper.
- `pnpm check` passed: boundary, egress, duplication/dead exports, findings, types and
  **1,641 tests**. The final prompt change also passed the targeted evaluation tests.
- Expected sandbox credential/configuration failures remain in local logs as installation
  history. They were resolved; failure bodies are not copied into routine evaluation reports.

No application user traffic is automatically sent to Dify. Live evaluations require `--send`;
the selected context and response then remain in the local Dify trace for explicit inspection.
