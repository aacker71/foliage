# Source selection and Ladybug connection

Implemented on 2026-09-09. Open **Sources** (`/workflow#sources`) in the local Leaf app.

The source picker supports search, project/file selection, a literal text preview, and an
explicit addition to the existing private review queue. No source selection verifies
contribution, computes a score, approves work, or publishes it.

| Source | Implemented behavior | Remaining connection work |
|---|---|---|
| Open Design | Discover local project names; choose one supported file; preview and import its text. | Hosted account access and ongoing synchronization. |
| Figma | Select a text or SVG export; choose a local PNG/JPEG frame through Design image. The origin label is owner-declared. | Registered Foliage OAuth app, `file_content:read`, selected file/node authorization, image capture, revocation and acceptance against a real account. |
| Design image | Select one local PNG/JPEG, inspect the actual pixels, and add it to private Review. An optional owner-entered public Dribbble shot URL is a reference, never a download. | Direct Figma account/frame connection. Dribbble API ingestion remains on hold under its published data-use terms. |
| Claude Design | Select an exported artifact. | Qualify a supported direct acquisition interface and account authorization. |
| Git | Existing local repository connection and collection. | Repository discovery and hosted account selection. |
| Personal project | Name one project; select 1–8 local TXT, Markdown, HTML, SVG or CSV files; inspect each full text and add the batch to private Review. | Ongoing folder sync, binary extraction and provider authorization. |
| Documents, presentations, AI-assisted work, other work | Select a text, Markdown, HTML, SVG or CSV export. | Named provider authorization and adapters; binary document extraction. |

Exports remain declared local snapshots, not authenticated provider evidence. This screen does
not read assistant conversation history. HTML and SVG are displayed as text, never rendered or
executed. Selection allows one-time local import; it does not grant persistent synchronization.
The source catalog is not a list of connected vendor accounts.

Figma's [file/image endpoints](https://developers.figma.com/docs/rest-api/file-endpoints/)
can support a future consented selected-frame connection, but this local export path does
not call Figma. [Dribbble's API terms](https://developer.dribbble.com/terms/) restrict
copying or storing platform data. Foliage does not fetch a provider image from a link;
the selected image must be a file the owner already holds and has the right to use. The URL is their
reference to where they shared it, not authenticated evidence of authorship. A private Figma
file link is not stored in the Review evidence because publication would carry it outward.

The Personal project picker reads only files the owner chooses in the browser. It refuses
empty, binary, duplicate-named or unsupported files, files over 15 KB, a batch over 96 KB,
or more than eight files. The preview shows the complete literal text of each selected file;
the same text enters Review without truncation. Import is one locked batch: a refusal leaves
the existing queue untouched. Each project/file name pair has a stable record identity and
each file's content has its own revision. Use one unique project name and reuse its exact
spelling for updates; unrelated projects with the same name and file names share that local
identity. Preview identifies files that already exist and files that will be new revisions.
Repeating an unchanged selection retains its Review decision when that snapshot's material
has not been locally edited; an edited Review title makes the importer refuse the entire
batch rather than overwrite it. Changed text enters as a new unreviewed draft. Observation time is the time of
selection, not a claimed work date. Selection grants no background scan, authorship,
approval, sync or publication.

## Local source configuration

The Leaf server uses its existing `FOLIAGE_LEAF` and `FOLIAGE_HARVEST` destinations.
`FOLIAGE_OPEN_DESIGN_ROOT` optionally overrides the local project root; the default is the
macOS Open Design release-stable project directory under Application Support.

Opening Sources only reads connection status and the static catalog. Choosing Open Design
lists project directories and optional bounded package labels. Choosing a project lists file
names. Choosing a file reads its content. Limits: 200 projects/files, depth three, 2,000
examined entries, 256 KiB per file, and a visibly identified excerpt of at most 15,000
characters. Hidden/dependency/build directories and linked files are excluded. Previews expire
after 15 minutes; changed content or a changed Leaf is refused at import. Identical revisions
use the existing importer's replay behavior and preserve prior review decisions.

Older unbound review queues have a separate destination preview. The user sees the Leaf and
existing draft titles before linking that exact queue revision. Conflicting existing owners
are refused. Linking retains the candidates and decisions and makes no authorship claim.

## Ladybug handoff

The open Leaf app calls a generic authenticated loopback companion. Its implementation in
the Canopy manager stays in the closed plane. Pair the two local processes using one private
random 32-byte value encoded as 64 lowercase hex characters in `FOLIAGE_COMPANION_KEY`.
Set `FOLIAGE_COMPANION_ORIGIN` on Leaf to the manager's `http://127.0.0.1:<port>` origin.
Store the key outside the repository and do not put it in client bundles or URLs.

The app labels this companion Scarlet.

1. In Sources, the collapsed **Scarlet** section's **Connect** checks pairing and reports the
   manager's configuration state.
2. From a saved workflow draft, **Export evidence** shows the exact selected
   transfer and its limits.
3. **Continue with Scarlet** prepares a temporary copy in the paired local manager and opens
   its existing redacted import preview. No downloaded-file re-upload is necessary.
4. Saving, model consent, assessment and publication retain their existing separate gates.

The connection permits only its configured loopback destination, refuses redirects on service
requests, times out after ten seconds and bounds replies. Pairing endpoints reject browser
origins and require the private key. Only the transfer preview permits a form redirect to the
paired origin; published pages keep their existing policy. Prepared previews expire after
15 minutes. Disconnect clears the Leaf session connection; previously prepared copies are not
silently deleted. Pairing is installation-local, not hosted user or tenant authentication.

Cloud assessment configuration remains governed by `ladybugInference.ts`, including approved
provider settings and the configured model. A connected companion is not evidence of a
successful model run. On 2026-09-09 a metadata-only Fireworks model-list request returned HTTP
200 and listed `accounts/fireworks/models/kimi-k3`; no work was sent to inference and provider
privacy/residency approval was not established by that check.

### Collaborating on authored journeys

Open `/leaf/scarlet` (**Scarlet** under More) or **Work with Scarlet (cloud)** from an achievement. Readiness
is checked against the same configured companion without sending work; until it is ready the
page offers **Connect Scarlet** and keeps **Send** disabled. **Send**, under **Message
Scarlet**, sends only the selected journey, its current cited records/excerpts, the displayed
conversation and the owner's message to the configured Fireworks model. The companion owns
the provider credential; Leaf holds only the installation pairing key. Request context is bounded to 80 KiB, twelve evidence records,
eight history entries and a 2,000-character question. This operation permits no provider tools.

Scarlet returns an answer and optional revisions/highlight suggestions. The owner can edit and
save the proposed wording as one canonical revision, or apply a suggested highlight order
through the existing curation gate. Unknown records, invented citations, duplicates and changed
documents refuse the write. No proof tier, source evidence or publication authority changes.
Private scratch conversation survives navigation for up to two hours while the app runs;
restarting clears it. A timeout may mean cloud processing started; it never means a local edit
was accepted. Cloud suggestions allow up to 100 seconds at the companion boundary.

Auto-update settings use the existing workflow scheduler and enabled sources. They prepare
private collection drafts while the local app runs; unattended narrative rewriting and public
publication are not enabled. Email preferences are edited in the configured hosted account;
daily/weekly digest delivery is not implemented by this workspace.

## Observed validation

The real local Foliage Open Design README was selected in the browser and imported into an
isolated copy of the demo garden. It added one unreviewed candidate, leaving the prior 31
candidates unchanged. A saved real workflow packet reached the paired manager's private
import preview through the browser handoff. No inference, approval or publication was done.

Automated checks cover selected files, symlinks/guessed paths, changed content and subjects,
replay, explicit queue binding, origin refusal, request bounds and an actual paired HTTP
handoff using repository commit evidence. Run the repository's `pnpm check` for current results.
