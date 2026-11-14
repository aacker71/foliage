# Foliage — the quickstart

One path, one ending: **a folder on your disk holding your portfolio, open in your browser.**
This is the canonical route; the repo README is the reference for the individual CLIs
underneath it. Setup and first-use times have not yet been measured with a non-owner.

Your data lives in **`~/.foliage/`** (the "garden") — never inside this checkout. Foliage's
own servers bind to `127.0.0.1`; the export is a folder you control. Model-assisted drafting
depends on the provider you explicitly configure; the local command sequence below does not
set up an external provider.

## 0. Prerequisites

- **Node 22.18–24.** 22.18+ is required because the TypeScript sources run directly via type
  stripping — the server code has no build step. Below the floor, every command tells you so in one
  sentence rather than a loader stack.
- **pnpm 11+.** If you have Node but no pnpm: `corepack enable` activates the pinned version.
- **git**, and a repository you are authorized to read with commits attributable to you.
- **bun 1.3+** (from bun.sh). `pnpm check` builds the Workflow screen's browser bundle with it
  before anything else. Without it, step 1 stops with `bun: command not found`, and the
  Workflow and Connect a source screens say they are not built.

Check before starting: `node --version`, `pnpm --version`, `git --version`, `bun --version`.

## 1. Install and check — from the foliage checkout

```bash
pnpm install
pnpm check
```

`pnpm install` is **required first** — the apps import workspace packages that only exist as
symlinks after install; skipping it fails with a message saying exactly this. `pnpm check`
(boundary → egress → dup → findings → typecheck → tests) should be all green.

Every command below runs from the checkout directory as `node foliage.mjs …` — there is no
global `foliage` binary in the preview, so where output says `foliage <cmd>`, type
`node foliage.mjs <cmd>`. Suggested next commands include the absolute launcher path and
selected garden, so they also work from another directory. `node foliage.mjs <cmd> --help`
shows usage without creating or changing files.

To keep a separate garden, add `--garden /path/to/garden` to **every** command below, or
set `FOLIAGE_GARDEN` in that terminal. The flag wins over the environment. Relative garden
and source paths resolve from the current directory. Keep the same garden and `--repo`
when you move from growing to reviewing; the checkout is not necessarily your source repo.

## 2. Grow — your history becomes leaflets and candidates

Most people have MORE THAN ONE git identity (work, personal, GitHub noreply), and an omitted
one excludes your own commits. List what your repo actually recorded:

```bash
git -C /path/to/your-repo log --format='%ae' | sort -u
```

Then grow, naming every address that is yours (`--identity` is repeatable):

```bash
node foliage.mjs grow --repo /path/to/your-repo \
  --subject "Your name" --identity you@work.com --identity 12345+you@users.noreply.github.com
```

This runs intake (git history → attributed leaflets, into `~/.foliage/leaf.json`) and then
photosynthesis (drafting leaflet **candidates** for your review, into
`~/.foliage/harvest.json`), and ends by telling you how many candidates await you.

The output reports actual counts of `verified`, `pending` and `excluded` leaflets, and the
number of candidates awaiting review. An empty source produces an honest empty result.

**"0 verified" is correct, not broken.** `verified` means authorship is *cryptographically*
established — a signature git checked and accepted. A matching author email is never enough
(`git config user.email` is a string anyone can set to anyone). Unsigned history — most
history — lands in `pending`, honestly. Commits by authors you did not declare land in
`excluded`, each with its reason; also not an error.

**If it says some signatures could not be CHECKED, read that part.** git prints the same code
for "unsigned" and "I could not run the checker", so intake reads the commit objects and
reports the difference, with the remedy (install `gpg`, or configure
`gpg.ssh.allowedSignersFile`). Re-running grow after the remedy moves what verifies.

**Photos (optional).** To draft candidates from a folder of images, name the folder:

```bash
node foliage.mjs photos /path/to/folder
```

Only that folder and the folders inside it are read. Each image is stored in the garden (`~/.foliage/media/`) with its
metadata, location included, removed; your original file is not changed. Each image becomes a
candidate in the same review queue. A photograph shows that a file exists, not who made what
it shows, so an approved photo joins your leaf as `pending`.

## 3. Review — nothing joins your leaf without you

```bash
node foliage.mjs up
```

Open `/review` in the app. That page is the one review queue: approve, or reject with a
reason (a rejection without one is a silent disappearance, and the gate refuses it).
Approved candidates are promoted into your leaf as `pending` — reviewed-and-attributable,
never "verified"; nothing here can produce that word. `node foliage.mjs review` prints the
open count and the `/review` address; it decides nothing.

If approvals are saved but promotion fails, repair the named target problem, then run
`node foliage.mjs review --resume` with the same garden. This promotes saved approvals
without asking you to decide again; retrying does not add duplicate leaflets.

A refresh refuses damaged or unreadable prior data instead of replacing it with an empty
document. Grow has two stages: if intake succeeds and drafting fails, it says which stage
completed. A busy document means another operation holds its lock; retry after it finishes.
Locks left after a crash require inspection before deliberate removal. See
[local recovery details](docs/LOCAL-DOCUMENT-SAFETY.md).

## 4. Choose what to publish

Review approval does not publish a leaflet. Choose an actual leaflet id from your
`~/.foliage/leaf.json` and replace `<leaflet-id>` below with it. Read its title and evidence
before offering it for the exported page:

```bash
node foliage.mjs share '<leaflet-id>' --as public
```

Repeat only for work you want on the page. `--as public` is explicit: the default share is
`unlisted`, which gives a leaflet a link but does not include it in the exported index.
Private and unlisted leaflets stay off that page; attribution and your publish policy can
also withhold public leaflets. If none pass these gates, the export contains no work.

## 5. Export — a local copy to inspect before sharing

```bash
node foliage.mjs export
open ~/.foliage/site/index.html
```

That folder is self-contained — every reference relative, zero scripts, zero network
requests. Inspect the exact exported page before deciding whether to distribute it.
**A copied folder is not managed hosting:** edits, policy changes or withdrawal in Foliage
cannot recall a downloaded copy or remove a copy someone hosts elsewhere.

**Before you share it, read your own page once as a stranger.** Commit titles render
verbatim: if your history carries other people's names or addresses in subjects (merge
messages, pasted text), they will appear. The export REFUSES titles carrying email
addresses until you explicitly confirm — that refusal is the product working. And the page
never computes or shows a score of any kind, by design.

To browse locally with the review queue attached instead: `node foliage.mjs up` →
http://127.0.0.1:4174.

`node foliage.mjs canopy` opens the separate local publication manager and reader. Its
frozen public artifact includes only eligible verified titles and provenance; it does not
mirror rich local drafts, bodies or media. Pending work can leave that artifact empty.
Authenticated hosted upload, durable status/withdrawal and inspected US storage remain
launch gates; starting these loopback servers does not provide that hosted service. See
[Canopy Cloud](docs/CANOPY-CLOUD.md).

## Feedback

Open a GitHub issue. Please include:

1. Setup time separately from time to the first candidate/export once prerequisites work;
   record any assistance and the environment used.
2. Every place you stumbled — the command, what you expected, what happened. Verbatim error
   text is gold.
3. Did "0 verified" read as honest or as broken?
4. Would you act on this page — send it, or hire from it? What is missing?
5. Did anyone else's name or email appear on your page?
