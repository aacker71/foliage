# Unit 39: Keep one local project portfolio with the people who built it

Build package: `B03` · Owner: [leaf](../apps/leaf.md)
Acceptance: LV02, UX01, UX02, AU03, AU04, AU05, ST04
Specification: draft · Implementation: not accepted by this specification.

LV02 is claimed in part only: explicit contributions, joining and leaving. Company placement and
nested teams stay with [unit 14](./14-group-governance.md) and B05.

## Goal

People who built the same project keep one project portfolio together, each on their own
machine. Each member's part is only work their own Foliage already counts as theirs and that
they have marked public, cited by commit, in their own words. A local AI model drafts the
summary, impact and key features when a member asks or, if the member turns it on, on their
existing collection schedule. Nothing changes until every cited member approves. Each approved
key feature gets one 8-second demo. Teammates find each other through the repository they
already share.

Foliage runs no server and sends nothing itself. A member's record sits under a ref in the
project's own repository and moves only when that member hands a teammate a file (a git
bundle). Whether records may also go through the team's git remote is decision 2; a push would
send the record to whoever hosts that remote.

What this unit does not do yet: finding people outside a repository you share waits for a
shared index, which is paused. The team page is for members only; showing it to employers needs
each member's permission and comes later.

Owning application: leaf (open plane); pure logic in `packages/leaf`. Non-goals: no hosted page,
account, invite, database or server; no finding strangers; no recruiter agents or public brain
while the owner's local-only rule stands; no ranking, ordering by amount of work, per-member
counts, "top contributor" or score anywhere; no contribution inferred from anyone else's
commits; no git email in any team record or on the page (matching happens only on the member's
own machine, against their own declared identities, as intake does today); no team edit of a
member's own portfolio; no signed records; no company teams (unit 14).

## Design

**What a project is.** One repository, keyed by one parentless root commit every member's
checkout holds: the overlap rule `sameRepository` already uses (`apps/leaf/src/gitQueueSource.ts`).
With several roots, the first member names one with `--root <sha>`. Shallow clones are refused
by name, because git reports the shallow boundary as a root (measured). A fork shares the key and
the page says so. One project portfolio per repository.

**Where the record lives.** Each member writes exactly one ref, `refs/foliage/team/<root>/<id>`;
the id is random, made at join and kept in their garden. Not a branch (intake would read it as
work and gain a root commit, measured), not notes (they attach to commits and need merging), not
working-tree files (`apps/leaf/cells.mjs` keeps private material out of checkouts). Refs outside
`refs/heads` stay out of intake and repository identity, and a plain clone, fetch or push does
not carry them (measured). Teammates' records land under `refs/foliage/fetched/<root>/bundle/<id>`,
so receiving one never overwrites the member's own record.

The record is a reviewed projection, never `leaf.json`, `harvest.json`, cells or policy: schema
version, root, id, a display name the member chooses, their attached work (full sha, tier as
their garden holds it, title after `redactIdentifiers`, optional note in their own words), their
proposals, their approvals by statement digest, and their demos. No email, time, excluded item,
count or score.

**What may be written.** The display name, every note and every proposed statement are checked
before writing. Any span `detectRedactableSpans` finds (`packages/leaf/src/redaction.ts`: email,
identity trailer, account handle, phone number) refuses the write and names the span, as export
does with titles; it is never silently rewritten. `RATING_SHAPED`
(`packages/leaf/src/publishPolicy.ts`) refuses rating language, as
`apps/canopy/src/ladybugAssessment.ts` does for displayed names.

**Writing safely.** Foliage has never written objects or refs into a user's repository
(`foliage verify --setup` writes only local config, `foliage.mjs`). This is new behaviour and
keeps every intake safeguard:
- Two write paths, one rule. `foliage team … --confirm` and the `/leaf/team` page's same-origin
  POSTs both show exactly what will be written (the `foliage verify --setup` pattern) and write
  only on a second, explicit confirm. Never from `grow`, the install timer, scheduled upkeep or
  a page load.
- Intake's gates first: inside a work tree, then the config-ownership refusal
  (`refuseForeignConfig` in `packages/leaf/src/gitSource.ts`, exported for this).
- Plumbing only: `hash-object -w --no-filters --stdin` → `mktree` → `commit-tree --no-gpg-sign`
  with no parent → `update-ref <ref> <new> <old>`. The first write passes the all-zero old value,
  so it fails if the ref exists; a moved tip is refused, never overwritten (both measured). Each
  version is parentless, so a shared copy holds only the current record, never what was detached
  or edited before. No index, HEAD, branch or worktree.
- `-c core.hooksPath=/dev/null -c core.fsmonitor=false` (measured: unpinned, `update-ref` fires
  the reference-transaction hook; pinned, it does not), `GIT_NO_LAZY_FETCH=1`,
  `GIT_NO_REPLACE_OBJECTS=1`, `GIT_TERMINAL_PROMPT=0`, `GIT_OPTIONAL_LOCKS=0`,
  `GIT_CONFIG_COUNT=0`. `GIT_DIR`, `GIT_WORK_TREE`, `GIT_OBJECT_DIRECTORY`,
  `GIT_ALTERNATE_OBJECT_DIRECTORIES` and `GIT_INDEX_FILE` are cleared, so the writer cannot land
  in a different repository from the one it checked.
- Identity and time come from the child environment, which outranks every config file:
  `GIT_AUTHOR_NAME` and `GIT_COMMITTER_NAME` are the display name, `GIT_AUTHOR_EMAIL` and
  `GIT_COMMITTER_EMAIL` a fixed non-address placeholder named in the help, and
  `GIT_AUTHOR_DATE` and `GIT_COMMITTER_DATE` `@0 +0000`. A record holds no email, time zone or
  write time. `-c author.*` and `-c committer.*` repeat the same values as a backstop. Measured
  on git 2.54.0: `-c user.email` alone loses to a repository's `author.email` or `committer.email`
  and to an inherited `GIT_AUTHOR_EMAIL`; the environment wins over both.
- No signing. Every write passes `--no-gpg-sign`, and reading a record uses `cat-file` and
  `ls-tree` only, never `%G?`, `--show-signature` or `verify-commit`, so no signing or verifying
  program runs. Measured: a repository's own `gpg.ssh.defaultKeyCommand` ran under
  `commit-tree -S` even with `verifierPins` passed; with `--no-gpg-sign` it did not run, even
  with `commit.gpgSign=true`.

**Joining and attaching.** `foliage team join --repo <checkout> --name <display name> --confirm`
from a full clone holding the root writes the first record; no invite, server or email. Someone
with no commits may join (`No attached work yet`); non-commit work is a later change. People who
never joined are not listed.

`foliage team attach --leaflet <id>… --confirm` admits a leaflet only through the predicate
export's `crosses` uses (`apps/leaf/export.mjs`): `isSubjectsOwnWork(l) &&
isListedOnLeaf(leafletVisibility(l)) && outwardStateOf(policy, l).kind === "served"`, where
`outwardStateOf` wraps `evaluatePolicy` and `isAbsoluteDenial` (`apps/leaf/src/policy.ts`), and
the commit must be in this checkout. So only the member's own `public` work is attached: a
teammate is a reader who is not them, and `isListedOnLeaf` (`packages/leaf/src/leaf.ts`) keeps
`unlisted` work out of anything that lists a person's work to such a reader. The check runs in
`apps/leaf`, where `outwardStateOf` lives; the pure package receives only the admitted set. A
team-only listing consent would change that rule and is not made here. A commit already in a
teammate's record is refused by that teammate's name; if two records still hold one, both show
`Claimed twice`.

`UNRESOLVED decision 1`: may a `Co-authored-by` trailer naming a member let them attach someone
else's commit? Foliage reads only subject lines, so that commit is `excluded` in the co-author's
garden; this needs a trailer read and an intake change. Recommended: yes, `pending` only and never
`verified` (a trailer is self-declared, like an author email), matched on the member's own machine
against their declared identities, the trailer never written or shown. Until then:
`Already added by <name>`.

**Teammates' records are their own claims.** Tiers show as the teammate's garden recorded them,
never recomputed from emails. Nothing here proves who wrote a record: anyone who can hand over a
bundle can write or replace any member's record, and the page's help says so. Every teammate
record reads `Their own claim`. That is one reason the team page never leaves members' machines
in this unit; signed records, bound to the member id and checked with pinned programs, are a
follow-up that must land before any team page leaves the team. Each cited sha is checked with
`cat-file -e`, lazy fetch off; a missing one reads `Not in this checkout`, never dropped.

**Sharing is a file the member hands over.** Foliage never pushes or fetches over a network.
`foliage team share --confirm` runs `git bundle create <file> refs/foliage/team/<root>/<id>`, with
the same pins, to a file the member picks. Because records are parentless the bundle has no
prerequisites (measured). The member hands it to teammates however they like.
`foliage team receive <file> --confirm` reads `git bundle list-heads` first, accepts only a bundle
holding exactly one record ref under this root that is not the receiver's own id, and fetches it
into `refs/foliage/fetched/<root>/bundle/<id>` (measured on git 2.54.0). A received record stays
until a newer one from the same id replaces it or the receiver runs
`foliage team forget <id> --confirm`.

`UNRESOLVED decision 2`: may records also travel through the team's git remote? (a) Bundle only,
as above. (b) `share` also prints `git push <remote> refs/foliage/team/<root>/<id>:refs/foliage/team/<root>/<id>`
and `git fetch --prune <remote> '+refs/foliage/team/<root>/*:refs/foliage/fetched/<root>/remote/*'`
for the member to run; remote copies land in their own namespace, so a prune never drops a
bundle copy (measured). (c) Foliage runs exactly those two commands when the member presses
Share or Refresh, never in the background. A push sends the record to whoever hosts the remote:
anyone who can read it can list and fetch the ref, which on a public repository means everyone,
and the host may keep the objects after the ref is deleted (measured on a bare remote; GitHub
also shares objects across a fork network). Under (b) or (c), `share` says `Anyone who can read
<remote> can read this record`; a pushed record carries only statements every cited member has
approved, and open proposals that cite someone else travel by bundle. The cost of (a): every
round of proposals and approvals is a file handed over by hand. Recommended: (a) in this unit,
under the 2026-10-10 local-only rule; (c) is the easiest to use if the owner later allows a git
host.

**Discovery.** Collaborators are the people whose records you received for the repository you
already share. Finding people outside it needs a shared index; that is paused, and this unit
adds none.

**The AI drafts the project, as proposals.** Drafts come from the model chosen at
`/scarlet/setup`, through `streamChat` and `loopbackFetch` (127.0.0.1 only, no redirects). They
run on `foliage team propose` or a page POST, or, if the member turns it on, on their existing
collection schedule, skipping when Paused or in quiet hours as journey upkeep does
(`apps/leaf/src/workflow.ts`). Scheduled drafts stay in the member's garden under
`Waiting for you`; nothing reaches the record until the member confirms a write.

Loopback alone does not keep content on the machine. Ollama serves cloud models from ollama.com
behind the local daemon, and `loopbackFetch` checks only the first hop
(`apps/leaf/src/loopbackFetch.ts`); `/scarlet/setup` offers every name `/api/tags` returns
(`apps/leaf/src/scarletModelSetup.ts`). Team drafting refuses any model whose name ends in
`-cloud` or `:cloud`, or whose `/api/tags` or `/api/show` entry carries `remote_host` or
`remote_model`, with `Cloud model · team drafts use a model on this machine`. Not measured: the
installed Ollama 0.32.5 lists no cloud model. One real cloud model is checked before this ships.

It drafts `summary` (name and what the project is), `impact` (every sentence cites attached work;
no ratings, per `RATING_SHAPED`; no motives; failures stay failures) and `feature` (one key
feature, citing the work that built it). The proposer picks the input items, at most 12, shown
in record order with no weighting by member. The model gets their redacted titles and notes from
the records, never raw commit subjects, authors or patches; `readScarletSource` prints author
emails (`apps/leaf/src/scarletSource.ts`) and is not used. A citation outside the picked set
refuses the whole proposal, as `parseJourneyResponse` does. A number must appear in a cited
item's title or note: a team variant of `assertCitedNumbers`
(`packages/leaf/src/claimNumberSupport.ts`) takes its fragments from the records and reuses the
same number tokenizer, because the existing check resolves citations against the proposer's own
Leaf. Every statement is screened like a note before it is written. No model:
`No local model · write it yourself`, with the same approval.

Team records and `refs/foliage/fetched` objects are read only by `/leaf/team` and `foliage team`.
They are never indexed by the brain, never exposed through MCP or private-brain tools
(`apps/leaf/private-brain.mjs`), never read by Scarlet, never sent to TypeSafe, Fireworks or the
assessment companion under any existing consent, and never published. Teammates never gave
their words for that. A test pins it.

A statement cites at least one attached item, lives in its proposer's record, and is approved
when every member it cites holds an approval of its exact digest. `Proposed` → `Needs approval
from <names>` → `Approved`; `Out of date · work changed` when a cited item goes or its member
leaves. An edit restarts approval; new work feeds the next proposal and leaves approvals standing.

**One 8-second demo per approved key feature.** The local model lists approved features with no
demo and suggests the page and the scene to show. A member the feature cites records it with
`foliage capture --url <loopback URL> --seconds 8`, the capture page (it offers only 6, 10 or 15
seconds today, so this unit adds 8), or their own agent through the existing demo-browser MCP
tools under their existing grant, which keep the clip in Review. The team AI does not drive a
browser itself in this unit. A clip attaches after its owner's Review approves it, and only if
its length, measured from the MP4 with the ffmpeg capture already uses, is 8 seconds at 6 fps.
The receipt's `frameCount` is the planned count (`tools/capture/capture.mjs`), not a
measurement. The receipt travels with the clip; a teammate's clip without one reads
`Length not checked`. A clip reads `Recorded from the running app · commit not checked` unless it
came from a revision-bound capture (unit 26, still open).

`UNRESOLVED decision 3`: where do clips live? Recommended: commit the reviewed clip, still and
receipt into the member's own record, capped at 1 MiB (export's public clip limit), so the bundle
carries them; fix the cap only after measuring one real 8-second clip at the default 1280×720 (no
clip size is measured on main). Under decision 2 (b) or (c) the clip goes to the git host too.
Otherwise clips stay local, cited by digest, and teammates see `Demo on <name>'s machine`.

**The project page.** `/leaf/team` renders on each member's machine from their record plus
received ones: approved summary (`Untitled project` until then), impact, features with demos, and
members alphabetical by display name, each with their attached work in their own tiers (verified,
pending, unordered) and `Their own claim`. `Waiting for you` holds the viewer's approvals and
scheduled drafts. No per-member count, ordering or score. Leaf binds to loopback, so nobody else
can open it. `foliage export` stays each member's own choice and carries only their own work; a
team page in export would put teammates on the web and needs each one's permission (AU03), so it
is not in this unit.

**Leaving.** `foliage team leave --confirm` replaces the member's record with an empty `left`
record, writes its bundle for the member to hand over, then deletes their own ref
(`update-ref -d`). A teammate who receives that bundle drops them: their work, approvals and
demos go; statements citing only them become `Withdrawn`, others `Out of date · work changed`. A
teammate who never receives it keeps the old copy until they run `foliage team forget`. Under
decision 2 (b) or (c), `leave` also prints or runs `git push <remote> :refs/foliage/team/<root>/<id>`;
the fetch needs `--prune`, without which a deleted record stays in teammates' copies (measured).
The command says copies already received cannot be recalled, and a git host may keep the
objects after the ref is deleted.

**Labels.** `Not the same repository` · `Shallow clone · fetch full history` · `Not your work` ·
`Only public work can be added` · `Blocked by your policy` · `Already added by <name>` ·
`Claimed twice` · `Their own claim` · `Not in this checkout` · `Record changed · try again` ·
`Cloud model · team drafts use a model on this machine` · `Demo must be 8 seconds`. Screens
follow [UI context](../ui-context.md) with the existing `ui` facade controls only (button, link,
input, textarea, label, alert); labels are text, and no new component is added.

## Implementation

1. `packages/leaf/src/teamProject.ts` (pure): record schema and parser, key rule, name, note and
   statement screening, statement states, approval by digest, proposal validation with the team
   number check, and `composeProjectPage(...)` (alphabetical, no counts). Tests pin the
   no-ranking law.
2. `apps/leaf/src/teamRepo.ts`: plumbing writer, bundle writer and reader, with the gates, pins
   and environment above. Each safeguard has a scratch-repository test, including one with
   `author.email` and `committer.email` set in global and repository config and
   `GIT_AUTHOR_EMAIL` exported.
3. `apps/leaf/team.mjs`: `foliage team join|attach|detach|propose|approve|demo|share|receive|forget|status|leave`,
   writes behind `--confirm`; attach admission composed here with `outwardStateOf`; help rows in
   `foliage.mjs`; nothing added to `grow` or `install`.
4. Local upkeep under a new local-only policy identity, not `JOURNEY_MAINTENANCE_POLICY` or
   `decideJevPool`, which both leave the machine; the cloud-model refusal; the opt-in schedule
   reusing Paused and quiet hours.
5. `8 seconds` in `apps/leaf/src/capturePage.ts` and `apps/leaf/server.mjs`; the `/leaf/team`
   page there (GET reads only; attach, propose and approve POSTs show the exact write and need a
   second press).
6. A test that brain search, the MCP tools, the private-brain pilot, Scarlet and export never read
   team refs.

No host is added to `public-boundary.json` and nothing imports `@foliage/canopy`.

## Dependencies

- Required units: [09](./09-sources-cells.md), [11](./11-achievement-model.md), [12](./12-local-review.md), [33](./33-capture-clients.md)
- Packages: none new. Git behaviour above was measured on git 2.54.0 only. Chrome and ffmpeg for
  capture, as today; a local Ollama model is optional.
- Provider inputs: none. Revision-bound demos wait on unit 26 but are not required.

## Verify when done

- [ ] The owner approves the `/leaf/team` page and the 8-second capture option as final before
  any backend work is called done; the open decisions are asked on that design.
- [ ] Two real people on two machines, each with their own garden and a full clone of one real
  repository, join, attach, share by bundle, receive, and see the same members and approved
  statements. Another repository and a depth-1 clone are refused by name. Only if decision 2
  allows a remote: the same once by push and `fetch --prune`.
- [ ] Attach refuses an `excluded`, an unlisted, a private and a policy-denied leaflet and someone
  else's commit; a commit attached by A is refused for B with A's name.
- [ ] After every team command, `git log --branches HEAD`, the root-commit set and intake output
  match a run before it. With each set repo-locally to a script, hooks, `fsmonitor`,
  `gpg.program`, `gpg.ssh.program` and `gpg.ssh.defaultKeyCommand` never ran. Nothing crossed the
  network unless a person ran a printed command or, under decision 2 (c), pressed Share or Refresh.
- [ ] With `author.email` and `committer.email` set in global and repository config and
  `GIT_AUTHOR_EMAIL` exported, the record's commit object holds only the placeholder and
  `0 +0000`. No email address in any record object, the rendered page or the garden's team files
  (grep). A display name or note holding an email or a rating is refused.
- [ ] A leaves; B receives A's last bundle (or, under decision 2, runs the printed fetch once),
  and A is gone from B's page.
- [ ] Page: members alphabetical; no per-member number in the HTML (grep); tiers per item,
  unordered; every teammate reads `Their own claim`; a missing commit reads `Not in this checkout`.
- [ ] With a local model, a proposal citing unpicked work or an unsupported number is refused
  whole; approval needs every cited member; leaving gives `Withdrawn` or `Out of date`. A cloud
  model is refused, checked once against a real one. During propose, attach, approve, scheduled
  upkeep and page reads, neither Foliage nor the Ollama daemon opens a connection beyond loopback,
  watched per process.
- [ ] A 6-second clip is refused `Demo must be 8 seconds`; an 8-second reviewed clip appears on
  both members' pages, and its measured length and size are recorded.
- [ ] Team refs never appear in brain search, MCP or private-brain output, Scarlet context or
  export (the test above plus one manual check).
- [ ] `pnpm check` green. Everything stays built-but-unverified until two people finish the flow
  on separate machines.

## Shared context

Owner direction 2026-09-30: "connect as a team on their project portfolio like a collaborative
portfolio ai maintains the project and scopes impact and curates short demo videos of 8 seconds
for each key feature", and "help people discover collaborators through work they're already
doing, rather than requiring them to network from scratch." Owner direction 2026-10-10, which
wins: Wondersearch is paused and users want everything to stay local to their system.

This replaces the hosted-first draft in [PR #199](https://github.com/aacker71/foliage/pull/199),
on hold and stacked on the paused [PR #132](https://github.com/aacker71/foliage/pull/132); it keeps
that draft's laws and drops its hosted parts. "AI maintains the project" is read as opt-in
scheduled drafting with the local model, with writes only on confirm; "curates" as the AI choosing
which features need a demo and suggesting the scene, with a person or their own agent recording.

Build package B03, because the work extends each member's own journey on their own machine; the
delivery plan's B03 row now names this slice. It depends on unit 12 (local Review), which sits in
B04. That is a package-order exception, stated here rather than hidden. LV02's evidence row
(separate accounts) is not redefined; this unit supplies two people on two machines toward it.

Four choices are marked `UNRESOLVED` and asked together: decisions 1–3 above, and
`UNRESOLVED decision 4`: where this unit sits in the [release path](../../.loop/MILESTONES.md).
Recommended: right after gate 1, since it needs only each member's private record and nothing
hosted. Until the owner answers it stays inside gate 5's unit range.
