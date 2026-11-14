# Unit 38: Keep each garden's brain in a packaged local gbrain

Build package: `B03` · Owner: [leaf](../apps/leaf.md)
Acceptance: LV01, AU04, AU05, ST04, OP01
Specification: draft · Implementation: not accepted by this specification.

## Goal

Each garden gets its own brain: a pinned copy of gbrain that ships with Foliage, runs on the
owner's machine, and is built and kept current by Foliage from that garden's own records.
Searching it works with the network off. Nothing leaves the machine: every gbrain path that can
reach the network is switched off in the config Foliage writes and checked before each use, and
a gate proves it by watching for connection attempts inside a sandbox. Foliage's laws hold at
the boundary: no score in anything Foliage returns, tiers unordered, an excluded record returned
only with its reason and never its body, drafts and past versions labelled, nothing about other
people added to the brain. Search through the brain never returns fewer matches than today's
search over the same records.

Owning application: leaf (open plane). Page projection and result mapping are pure code in
`packages/photosynthesis`; processes, files and locks live in `apps/leaf`. Non-goals: no hosted
brain and no Wondersearch; no reading or writing the owner's own `~/.gbrain` or `~/brain`; no
gbrain MCP server handed to any agent; none of gbrain's model features (query expansion, think,
dream, fact extraction, subagents); no change to the revision-bound brain tools or public
search; no model or package download on the user's machine.

gbrain paths (`src/…`, `scripts/…`, its `LICENSE`) are inside the pinned gbrain tree,
`github:garrytan/gbrain` at `15b9863d13635d173562a54f55a1d388bfcf546b` (0.42.73.2). Every other
path is Foliage's, on `origin/main` at `b46d251a`. "Measured" means one of the two 2026-10-10
probes described in Shared context; everything else is read from source or inferred, and says
so.

## Design

**One brain per garden, inside the garden.** Foliage owns `<garden>/brain/`:

| Path | What it is |
|---|---|
| `manifest.json` | Foliage's own record of the brain: schema version, Leaf id and subject, sha256 of the `leaf.json` and `harvest.json` bytes it was built from, mode (`keyword` or `local-embedding`), pinned gbrain version, commit and integrity, and every page as slug → record id and page digest. Written last, atomically. |
| `pages/foliage/<hex>.md` | One markdown page per record, written by Foliage. |
| `home/` | `GBRAIN_HOME` and `HOME` for every gbrain process. Config at `home/.gbrain/config.json`, database at `home/.gbrain/brain.pglite` (42 MB empty, measured). |
| `work/` | Empty working directory for every gbrain process. |
| `bin/` | Empty directory that is the whole `PATH` for every gbrain process. |
| `.brain-lock` | The brain's own lock (Building, step 1). |

Two brains ran side by side on one machine with nothing shared when each had its own
`GBRAIN_HOME` and `HOME` (measured). `HOME` matters because a few gbrain paths ignore
`GBRAIN_HOME` (`src/core/mounts-cache.ts:36`, `src/core/context/reflex.ts:100`). gbrain also
looks upward from its working directory for `.gbrain-source` and `.gbrain-mount` files
(`src/core/source-resolver.ts:113-117`, `src/core/brain-resolver.ts:12, :27, :36-58`). This
checkout has a `.gbrain-source` at its root (gitignored, `.gitignore:181`), and a garden under
such a file made both `import` and `call` stop with `Source "gstack-code-foliage-74312690" not
found` (measured). So every command names its brain and source explicitly (see "Every gbrain
process"); an explicit flag is the first tier in both resolvers.

The brain is derived data: deleting `<garden>/brain/` loses nothing, and `foliage brain rebuild`
recreates it. No brain code writes `leaf.json`, `harvest.json` or any other garden file. A
changed Leaf id or subject rebuilds the brain from scratch, matching the identity checks in
`apps/leaf/src/localSearch.ts:8-44`.

**What goes in.** Records come from `gardenSearchRecords`
(`packages/photosynthesis/src/searchGarden.ts:77-127`), the records `foliage search` covers
today: owner profile, achievement statements, verified and pending leaflets, past versions and
drafts. One new pure function, `brainRecords`, narrows them, and `foliage search` and
`foliage_search` use that same set whichever engine answers, so a result never depends on
whether the brain was available:

- An excluded leaflet keeps only its title and its reason. Its body, which is work the owner did
  not do, never enters the brain or any result.
- Any record whose evidence or provenance has a `third-party` source segment is held back:
  drafts resting on `brain-note:third-party` notes
  (`packages/photosynthesis/src/brainIntake.ts:197`), and also leaflets, claims and past
  versions that carry the same provenance after promotion. The test is the one the
  `deny-third-party-evidence` publish rule uses, a `third-party` segment in the source split on
  `:` (`packages/leaf/src/publishPolicy.ts:329-330`, rule at `:717-721`). It is exported once
  from `packages/leaf` and used in both places.

**Excluded hits carry their reason, on every private surface.** Today an excluded leaflet's
search text is its body with the reason appended (`searchGarden.ts:104`), and the snippet is a
240-character window starting near the first matched term, or at 0 when no term is in the text
(`searchGarden.ts:33-44`). A title-only match on an excluded leaflet with a longer body returns
the first 240 characters of somebody else's work and no reason. Fix, in shared code so the
fallback and the private-brain session hold too: `gardenSearchRecords` sets a `reason` field on
excluded leaflets, and `searchRecords` (`searchGarden.ts:47-68`) returns that reason as the
snippet and as a `reason` field on the hit, never an excerpt of the text. Test: an excluded
leaflet with a 500-character body and a query matching only its title returns the reason and no
body text, through the brain, the fallback and the private-brain session.

`Decided 2026-10-12` decision 1 — Which records go in. The owner replied "Proceed" to the
recommendation. **Outcome:** everything private goes in, labelled (drafts and past versions
included), minus excluded bodies and third-party records, as listed above: an excluded leaflet
keeps only its title and its reason, and a record resting on `third-party` evidence or
provenance is held back. It never leaves the machine, and approved-only would have dropped the
drafts that `foliage_search` returns today and its test requires
(`apps/leaf/src/assistantMcp.test.ts:86-125`).

`Still open` — Text from an excluded leaflet still present under its draft or a past version.
Before a leaflet is excluded, its body may already be in the brain under another record: the
draft it was promoted from (same excerpt text) or a past version. Those records are edited in
place or removed, and purged at the SQL level only (Building, step 5), so the bytes can stay in
PGLite's files, or stay findable through the draft. Whether removing or editing such a record
must force a rebuild is not decided (raised with build item 3, #204).

**Page format.**

```markdown
---
type: "foliage-record"
title: "<record title>"
foliage_record: "<record id, e.g. claim:a1:c2>"
foliage_kind: "<owner profile | achievement <kind> | verified leaflet | pending leaflet | excluded leaflet | past version | <state> draft>"
foliage_tier: "verified" | "pending" | "excluded" | null
foliage_reason: "<excluded leaflets only>"
foliage_citation: "<leaf:… or harvest:…>"
foliage_updated_at: "<the record's updatedAt>" | null
foliage_leaf: "<Leaf id>"
foliage_digest: "<sha256 of this page's fields and body>"
foliage_evidence: [{ "source": "…", "ref": "…", "observedAt": "…" }]
---
# <record title>

<record text, with structure lines made inert>
```

- Every frontmatter value is written as JSON (valid YAML), and a title, id or reason holding a
  newline is refused.
- The title is repeated as the first body line. Keyword search reads only
  `content_chunks.search_vector` (`src/core/pglite-schema.ts:1020-1030`), so frontmatter is not
  searched: a word only in the frontmatter title returned 0 hits, and the same word as an H1
  line was found (measured). The frontmatter title still wins as gbrain's title
  (`src/core/markdown.ts:152-155`). The H1 also gives a record with empty text, such as an
  achievement with no claims (`searchGarden.ts:90-92`), a chunk; with no body at all gbrain
  stores no chunk (`src/core/import-file.ts:900-905`) and could never return it (inferred).
- Structure lines are made inert. gbrain splits a body at `<!-- timeline -->`,
  `--- timeline ---`, or `---` followed by `## Timeline` or `## History`
  (`src/core/markdown.ts:380-399`), and reads `<!--- gbrain:facts:begin -->` fences
  (`src/core/facts-fence.ts:53`, `src/core/import-file.ts:110-122`). A record line
  `<!-- timeline -->` moved the rest of that record into gbrain's timeline field (measured).
  Foliage rewrites such lines to an inert form in the page only; snippets come from the live
  record, so nobody sees the rewrite. A test covers each marker. Slug injection is not possible:
  the file path decides the slug (`src/core/import-file.ts:1050-1111`).
- Slug `foliage/<sha256(leafId, recordId) hex>`. No tier, kind or title in the path, and never
  under `people/`, `companies/`, `deals/`, `meetings/` or `archive/`, which gbrain boosts or
  demotes (`src/core/search/source-boost.ts:15-50`).
- `type: foliage-record` is outside gbrain's fact and chronicle extraction types (measured: both
  skipped; `src/core/facts/eligibility.ts:70-95`). Every page has this one type on purpose:
  varying it by tier or kind would let a label change ranking.
- No `id`, `tags`, `date` or `effective_date` keys, which gbrain reads as identity, tags or
  recency (`src/core/import-file.ts:639-697`).
- Labels live in frontmatter and in the hit Foliage builds, never in the searchable body, so a
  tier cannot move a page up or down. Through gbrain alone a label or kind word such as "draft"
  no longer matches; those matches still come back through Foliage's own matches, which are
  added after gbrain's (Reading, step 4).

**Building and keeping it current.** `foliage brain build` and every refresh:

1. Take the brain lock, `<garden>/brain/.brain-lock`, holding pid, token and start time. Waiting
   means polling for up to 5 seconds. This is not the `.local-lock` helper
   (`packages/leaf/src/localFiles.ts:43-66`), which fails at once with `ELOCALBUSY` and by design
   never reclaims a lock, because record documents must not be stolen. The brain is derived
   data, so its lock may be reclaimed, only when the recorded pid is no longer alive
   (`process.kill(pid, 0)` fails with `ESRCH`), the rule gbrain's own PGLite lock uses
   (`src/core/pglite-lock.ts:117-120, :188`). `foliage brain rebuild` applies the same check. A
   reused pid makes the lock look held, which only makes reads fall back. Every gbrain process
   runs under this lock, which also respects PGLite's single-writer lock. Record documents are
   read, never locked or written.
2. Read `leaf.json` and `harvest.json` once and hash them. Same as the manifest: done.
3. Project pages from `brainRecords` (pure code). Write changed pages atomically; delete files of
   removed records.
4. `gbrain --brain host import <pages> --no-embed --fresh --include-gitignored --source-id default`.
   - `--fresh`: after a killed run or any error, import keeps `import-checkpoint.json` in
     `GBRAIN_HOME` (`src/commands/import.ts:258-270, :486-489`), and the next run without
     `--fresh` skips every path it lists as done, whether or not the file changed
     (`src/core/import-checkpoint.ts:155-165`). With `--fresh`, unchanged pages are still
     skipped by content hash (measured: "13 unchanged").
   - `--include-gitignored`: inside any git work tree, import lists files with
     `git ls-files --exclude-standard` (`src/commands/import.ts:676-688, :736-739`). A garden
     inside a repo whose `.gitignore` covers `brain/` imported 0 pages and exited cleanly
     (measured). The brain would be empty while the manifest said current.
   - Import never deletes (measured).
5. Removal. For a removed record: `call delete_page`, then
   `call purge_deleted_pages {"older_than_hours":0}`, then `get_page` with
   `"include_deleted": true` and `get_versions` must both return nothing. The purge cutoff
   defaults to 72 hours (`src/core/operations.ts:1712-1724`,
   `src/core/pglite-engine.ts:1194-1207`): a default purge returned count 0 and `get_versions`
   still returned the old text; with `0` it returned count 1 and `get_versions` returned `[]`
   (measured). Versions, chunks and links go with the page (`ON DELETE CASCADE`,
   `src/core/pglite-schema.ts:221, :269-270, :395`). A plain `get_page` hides soft-deleted pages
   (`src/core/operations.ts:946-957`), so it proves nothing on its own.
   Removals the law drives are different: a leaflet newly excluded, or a record newly resting
   on third-party notes. Deleted and overwritten rows stay in PGLite's data files until a
   vacuum, which no allowed command runs (inferred), so purge removes them at the SQL level
   only. Those removals rebuild the brain in `brain.next/` and swap it in, so the bytes go too.
   A rebuild is also the path for any removal whose check fails. A removal is not reported done
   until its check passes.
6. Confirm before the manifest: `list_pages` with an explicit limit, paged, returns exactly the
   manifest's slugs, and `get_page` on every changed page returns its `foliage_digest`. A
   mismatch is a named failure and the manifest is not written.
7. Write `manifest.json` last. A crash before that leaves the old digest, so the next refresh
   redoes the work: `--fresh` looks at every page, and an already-deleted page counts as
   deleted.

A refresh runs at the end of `foliage grow`, `review --resume` (which promotes),
`migrate-queue --apply`, `capture`, `share` and `unshare`; after `foliage up` saves a review
decision, promotion or edit, and after a collection pass changes the harvest; and after every
MCP tool that is not read-only (`apps/leaf/src/assistantMcp.ts:67-128`,
`apps/leaf/src/assistantAchievements.ts:48-53`, and the capture and project-evaluation tools),
because an owner who only uses an agent host never runs `foliage up`. Each is queued behind the
response and never blocks it. A 30-second digest check inside `foliage up` catches anything else
that writes `leaf.json` or `harvest.json`, such as a hand edit or `harvest.mjs` run directly.
Publishing is not such a write: `foliage canopy` runs `apps/canopy/publish.mjs` and
`apps/canopy/withdraw.mjs`, which write or remove only the published copy (`publish.mjs:677`,
`withdraw.mjs:79`) and never `leaf.json` or `harvest.json`, and the brain does not hold the
published copy. Correctness does not depend on these triggers: every read compares the manifest
digest with the record and never uses a brain that is behind.

**Reading.**

1. Check the query (1–300 characters) and limit (1–10) with Foliage's own rules before any
   process starts.
2. Take the lock (polling up to 5 seconds) and confirm the brain is current. If it is behind,
   refresh it in place within a fixed bound (10 seconds proposed; PR 5 sets it from measured
   refresh times). If the brain is missing, still behind after that, busy, fails its checks, or
   the bundled runtime is missing, answer from Foliage's own search and say why.
3. Run `gbrain --brain host call --source default search
   {"query", "limit": min(3 × limit, 30), "mode": "conservative"}`. The `search` op forces query
   expansion off (`src/core/operations.ts:1888-1897`); `query`, `think` and every other op are
   refused before spawning.
4. gbrain's list is an ordering, not the result set. Its `search` op always deduplicates
   (`src/core/operations.ts:1874`, and on the hybrid path `src/core/search/hybrid.ts:1641`), and
   that drops matches two ways: no page type may exceed `ceil(0.6 × results)`
   (`src/core/search/dedup.ts:23, :129-130`), and every Foliage page has one type; and a chunk
   more than 0.85 Jaccard-similar to one already kept is dropped (`dedup.ts:22, :99`). With 10
   matching pages, limit 30 and limit 10 each returned 6 and limit 5 returned 3; a current claim
   and its past version, one word apart, came back as the past version only (measured). Today's
   search returns all of them, labelled. So: keep the first occurrence of each slug in gbrain's
   order, map it to a record id through the manifest, and look that record up in the live
   `brainRecords` projection of the bytes just hashed; drop any slug that is not there. Then add
   Foliage's own matches over the same records (`searchRecords`, today's ranking) that are not
   already listed, in their order, up to the limit. Recall is never below today's.
5. Build each hit as Foliage's own `{ id, kind, title, snippet, citation, evidence }` (plus
   `reason` for an excluded record) with Foliage's excerpt. Nothing is copied from gbrain's
   result: not `score`, `base_score`, any boost, gbrain's `evidence` match label (it said
   `high_vector_match` with embeddings off, measured), `create_safety`, `effective_date`,
   `stale`, `page_id`, `chunk_id` or `source_id`.
6. Hash the record again; if it changed during the read, answer from Foliage's own search.

The response gains one field, `retrieval`: `brain keyword`, `brain local embedding`, or
`foliage keyword` with `because` naming the cause. Hits keep today's shape apart from the
`reason` on excluded hits, so `packages/photosynthesis/src/searchGarden.test.ts:15, :21-24` and
`apps/leaf/src/assistantMcp.test.ts:86-125` hold unchanged. A search writes nothing to the
record. With `search.track_retrieval` false, no query cache on the keyword path, and eval capture
off (`"eval": {"capture": false}` in the file; `src/core/eval-capture.ts:251-255`) it should
write nothing to the brain either (switches read in `src/core/last-retrieved.ts:149`,
`src/core/search/query-cache.ts:367`; behaviour not yet measured).

**Which surfaces read the brain.**

| Surface | With this unit | Why |
|---|---|---|
| `foliage search` (`foliage.mjs:887-888` → `apps/leaf/search.mjs` → `searchLocalGarden`) | Reads the brain when it is current, then adds Foliage's own remaining matches; otherwise today's search, with the cause. Both over `brainRecords`. | It is the owner's search over the whole private record, which is what the brain holds. |
| `foliage_search` MCP tool (`--allow-search`, `apps/leaf/src/assistantMcp.ts:129-138`) | Same function as `foliage search` | Same records, bound subject and caps. |
| `--allow-brain` tools (`apps/leaf/src/assistantBrain.ts`, `packages/leaf/src/brain.ts`) | Unchanged | They promise literal-term matches in record order, pinned to one record revision (`brain.ts:69-82`, `brain.test.ts:44-47`). A separately refreshed index ranked by relevance breaks both, and 20,000 records are cheap to scan in process. |
| Private-brain session (`apps/leaf/private-brain.mjs`, `apps/leaf/src/privateBrainSession.ts`) | Unchanged, except that an excluded hit now carries its reason instead of a body excerpt (the shared fix above). Its digest covers whole records (`privateBrainSession.ts:39-40`), so a grant that includes an excluded leaflet reports `scope-changed` once (`:142`) and the owner grants again. | It ranks only the records the owner granted (`privateBrainSession.ts:139-144`). Ranking over a whole index lets ungranted text shape results, and its test refuses `score` and `evidence` in answers (`privateBrainCli.test.ts:65`). |
| Canopy public search (`apps/canopy/src/searchPublished.ts:7-8`) | Unchanged; never reads the private brain. Published records never carry `reason`. | Public search covers the published projection only. |
| Knowledge-base intake (`harvest.mjs propose-brain` → `apps/leaf/src/brainSource.ts` → `tools/vault/ask.mjs`) | Unchanged in this unit | It searches the owner's notes, not the garden. The release ships only `tools/vault/lib/rank.mjs` (`tools/deploy/package-local.mjs:36-42`), so an installed copy would likely stop with its missing-retriever cause (inferred, not run). A second gbrain home over the chosen notes folder is the natural fix: a follow-on with its own spec change. |

`Decided 2026-10-12` decision 2 — Replace Foliage's own keyword search or sit beside it. The
owner replied "Proceed" to the recommendation. **Outcome:** the brain sits beside Foliage's own
search, and today's search is the named fallback. When the brain answers, it orders the first
hits of `foliage search` and `foliage_search`, and Foliage's own matches fill the rest, so recall
never drops; today's search stays the only engine for the other surfaces. Retire it only after
the brain shows better recall on a real garden. Under decision 3, keyword-mode reads skip the
brain until local embeddings are on. Said plainly: in keyword mode the brain is not expected to
find more. It found 4 of 4 literal queries and 0 of 3 paraphrases on a three-page test garden
(measured), today's search is also literal, and the two orders were not compared side by side.

**Nothing leaves the machine.** The config file Foliage writes in keyword mode (the default):

```json
{
  "engine": "pglite",
  "database_path": "<garden>/brain/home/.gbrain/brain.pglite",
  "schema_pack": "gbrain-base-v2",
  "embedding_disabled": true,
  "self_upgrade": { "mode": "off" },
  "mcp": { "publish_skills": false, "publish_advisor": false },
  "eval": { "capture": false }
}
```

Foliage runs `init --pglite --no-embedding --non-interactive --path <database>` once, then
replaces the file, because init writes `self_upgrade.mode: notify` and
`mcp.publish_skills: true` (measured; `src/commands/init.ts:1047, 1051`). gbrain read this
exact file back through `config show` (measured). Local-embedding mode replaces
`embedding_disabled` with `"embedding_model": "ollama:nomic-embed-text"`,
`"embedding_dimensions": 768` and `"provider_base_urls": { "ollama": "http://127.0.0.1:11434/v1" }`
(or `llama-server:<id>` with explicit dimensions on `http://127.0.0.1:8080/v1`). Base URLs in
the file win over the environment and the database (`src/core/ai/build-gateway-config.ts:74-92`,
`src/core/config.ts:771-779`).

Settings gbrain keeps inside the database, set with `gbrain config set` after init:

| Key | Value | Stops |
|---|---|---|
| `search.mode` | `conservative` | the hosted reranker that the default `balanced` mode turns on (`src/core/search/mode.ts:287-297, 331-347`) |
| `search.reranker.enabled` | `false` | the same, independent of mode |
| `search.mcp_keyword_only` | `true` in keyword mode | any query embedding (`src/core/operations.ts:1870`) |
| `search.cache.enabled` | `false` | query text and results kept in the brain |
| `search.track_retrieval` | `false` | search writing `last_retrieved_at` (`src/core/operations.ts:1884, 1901`) |
| `facts.extraction_enabled` | `false` | page text sent to a fact model (`src/core/facts/extract.ts:43-48`) |
| `autopilot.auto_drain.enabled` | `false` | background model work |
| `auto_link`, `auto_timeline` | `false` | defence in depth only: both are read by `put_page` (`src/core/operations.ts:1300, :1312`), which Foliage never calls, and import does not consult them |

The five `search.*` keys were accepted without `--force` (measured); `facts.extraction_enabled`
needed `--force` (measured), and so did `auto_link` and `auto_timeline` (measured in review).
Whether each search switch changes behaviour is read from source; PR 2 confirms it.

The database can also supply provider base URLs and models when the file names none
(`src/core/config.ts:682, :747-779`). At build, rebuild, status and after an upgrade, Foliage
reads every key above back with `config get`, and runs `config unset --pattern
provider_base_urls.` and `config unset --pattern models.`. That command names each matching row
it removes and says `No keys match prefix` when there are none (measured, with a planted
`provider_base_urls.ollama`). Any row found fails the check by name, and the brain stays unused
until rebuilt. `eval.capture` lives only in the file (`config get` finds no such database key,
measured), so the exact-file check covers it.

`Decided 2026-10-12` decision 3 — Local embeddings when Ollama is present, or keyword-only
always. The owner replied "Proceed" to the recommendation. **Outcome:** keyword-only by default;
local embeddings only when the owner turns them on for a garden and a loopback embedder already
holds the model and is answering; Foliage never downloads a model. Keyword-mode reads skip the
brain until local embeddings are on: in keyword mode `foliage search` and `foliage_search` answer
from Foliage's own search. In keyword mode the brain only reorders the first hits and costs about
0.75 s per search (measured with build item 6, #207: medians of 7, sandboxed, on a small
synthetic garden; `foliage search` 224 ms on Foliage's own search against 1006 ms through the
brain, `foliage_search` 8 ms against 764 ms; not measured on a real garden). This narrows the
`foliage search` and `foliage_search` rows of the surfaces table and build item 6 to
local-embedding mode. Never automatic: gbrain treats an embedder that needs no key as always available and sends a request on
every search even when it is down (measured, loopback only; `src/core/ai/gateway.ts:993-995`),
search quality was not measured, and the model (about 270 MB for nomic-embed-text) is a download
the owner should choose. Foliage never pulls a model. Turning local embeddings on or off
rebuilds the brain: a `--no-embedding` init still creates the embedding column at the default
1280 dimensions (`src/core/pglite-schema.ts:225, :1118`, `src/core/ai/defaults.ts:20-21`), and
`embed` refuses a model whose dimension differs (`src/commands/embed.ts:254-283`). So the switch
inits `brain.next/` with `--embedding-model ollama:<model> --embedding-dimensions <n>
--skip-embed-check`, imports, runs `embed --stale`, checks, and swaps.

**Every gbrain process** starts through one function in `apps/leaf`:

- `<bun> --no-install --no-env-file <gbrain>/src/cli.ts --brain host …` by absolute path, never
  `PATH`. Node cannot load gbrain (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`, measured).
  Both bun flags exist in bun 1.3.14 (`bun --help`); the empty `work/` directory is a second
  guard against bun loading a `.env`. `--brain host` was measured with `config`, `import` and
  `call`; PR 2 confirms it with `init`.
- The environment is built from an allowlist and nothing is inherited: `PATH=<garden>/brain/bin`
  (empty), `HOME` and `GBRAIN_HOME` set to `<garden>/brain/home`, `TMPDIR` inside it,
  `GBRAIN_SELF_UPGRADE_MODE=off`, `GBRAIN_SKIP_STARTUP_HOOKS=1`, `GBRAIN_INIT_SKIP_EMBED_CHECK=1`
  and `BUN_RUNTIME_TRANSPILER_CACHE_PATH=0`. Without the last, bun wrote a transpiler cache under
  `HOME/Library/Caches/bun`, code outside the vendor digest; with it, none was written
  (measured). With the empty `PATH`, `init`, `config`, `import` and `call` all ran (measured), so
  no allowed command needs an outside program, and `/usr/bin/git` is out of reach: on a Mac
  without Command Line Tools it is the stub that offers to download them. No inherited
  `*_API_KEY`, `GEMINI_*`, `DATABASE_URL`, `GBRAIN_DATABASE_URL`, `GBRAIN_SOURCE`,
  `GBRAIN_BRAIN_ID`, `*_BASE_URL`, `HTTP(S)_PROXY`, `NO_PROXY`, `NODE_OPTIONS`, `BUN_*` or
  `GBRAIN_CONTRIBUTOR_MODE` can reach it.
- Allowed commands only: `--version`; `init`; `import --no-embed --fresh --include-gitignored
  --source-id default`; `embed --stale` (local mode); `config get|set` for the keys above and
  `config unset --pattern` for the two forbidden prefixes; and `call --source default` with
  `search`, `get_page`, `list_pages`, `get_versions`, `delete_page` or `purge_deleted_pages`.
  Arguments go as an argument list, never through a shell.
- A timeout and an output cap. A failure is a named cause, never an empty result.

**Checked before use.** Before any process starts: the bundled bun and gbrain match their pinned
versions and digests (entry files every time, the whole tree at install and in
`foliage brain status`); `GBRAIN_HOME` is absolute, inside the garden after resolving links, and
neither is nor sits under `~/.gbrain`; `config.json` equals Foliage's exactly, and any other key
(a `*_api_key`, `database_url`, `storage`, `remote_mcp`, a non-loopback base URL) is refused by
name; `work/` and `bin/` are empty. In local-embedding mode the embedder must answer on loopback
with the model present before the mode is turned on, and again before each search; when it is
not answering, the search answers from Foliage's own search with the cause rather than relying
on gbrain's untested fallback.

Every network path found in the 2026-10-10 audit, and what turns it off:

| gbrain path | Off by | Checked by |
|---|---|---|
| Update check on every command: a detached `gbrain check-update` found on `PATH` fetches raw.githubusercontent.com, and the spawn swallows its own errors (`src/cli.ts:159-223`, `:210-218`) | `GBRAIN_SELF_UPGRADE_MODE=off` and `GBRAIN_SKIP_STARTUP_HOOKS=1` (these cover the first `init`), `self_upgrade.mode: off` in the file, an empty `PATH` | environment test; file check; sandbox gate |
| Self-upgrade, `upgrade`, `check-update`, autopilot, skillpack registry | never run | command allowlist |
| Hosted embedding, reranking, query expansion, fact extraction and other model calls (ZeroEntropy, Anthropic, OpenAI and others). They fire whenever a key is present, even with `embedding_disabled` (`src/core/config.ts:597-604`, `src/core/ai/gateway.ts:858-870`); reranking fails open without a key (`src/core/search/mode.ts:338-347`) | no key in environment or file; `search` op only; database settings above | environment test with planted keys; file check; settings read-back; sandbox gate |
| Local embedder redirected or proxied (`OLLAMA_BASE_URL`, `LLAMA_SERVER_BASE_URL`, `HTTP(S)_PROXY`, database `provider_base_urls.*`) | variables stripped; loopback base URL pinned in the file; database rows removed | file check refuses non-loopback; `config unset --pattern` |
| Init's live test embedding | `--no-embedding`, `GBRAIN_INIT_SKIP_EMBED_CHECK=1` | command allowlist |
| Postgres switch through `DATABASE_URL` or `GBRAIN_DATABASE_URL` (`src/core/config.ts:549-596`) | variables stripped; `engine: pglite` | environment test; file check |
| Git pull, clone and push (`sync`, `sources add --url`, `sources harden`), and `git ls-files` inside a work tree | Foliage uses `import` and `delete_page`, never `sync` or `sources`; `--include-gitignored`; no `git` on `PATH` | command allowlist; garden-in-a-repo test |
| Routing files `.gbrain-source` and `.gbrain-mount` above the working directory | `--brain host`, `--source default`, `--source-id default` on every command | test garden under both files |
| Bun loading `.env` from the working directory (`src/core/config.ts:478-503`) | `--no-env-file`; empty `work/` | emptiness check |
| Storage, transcription, URL resolvers, integrations, auth, remote MCP, `serve --http` | no such keys in the file; never run; only `.md` pages imported | file check; command allowlist |
| Skill publishing over MCP | `publish_skills` and `publish_advisor` false; `serve` never run | file check |
| postinstall migrating whatever gbrain is on `PATH` (`scripts/postinstall.ts:30-41`) | staged with `--ignore-scripts` at package time; nothing installed on the user's machine | package test |
| Telemetry and query capture | none goes to third parties; `eval.capture: false`; `GBRAIN_CONTRIBUTOR_MODE` stripped | environment test; file check |

**Packaging.** The smallest safe shape is a second verified archive next to today's local
release, installed as its own unit:

- Pin `github:garrytan/gbrain` at commit `15b9863d13635d173562a54f55a1d388bfcf546b`
  (0.42.73.2, "v0.42.73.2 fix(security): fence dedup-resolved writes…", committed 2026-08-05),
  tarball integrity
  `sha512-9FN9VAsTCOBR862nG0XDIZ3YryfdGqZiij8IBNOXy/czCWw/ELXTJPHLTxhiSa9DQL3SFaVFLVCVbs6sp8L6vQ==`
  (from the owner's global `bun.lock`; the installed tree matched the cached `15b9863` tarball
  byte for byte, measured in review). Both go into `vendor/brain.json` at staging; any other
  commit or integrity is refused. The npm package named `gbrain` is unrelated code
  (`src/commands/check-update.ts:50-56`), so it is never installed by name.
- `tools/brain/stage-gbrain.mjs` stages it on the build machine with
  `bun install --frozen-lockfile --production --ignore-scripts` from upstream's own `bun.lock`,
  drops `test/`, `docs/`, `evals/`, `CHANGELOG.md`, `TODOS.md` and `llms-full.txt`, and places it
  at `vendor/gbrain/`, with bun 1.3.14 at `vendor/bun/bun` (the version CI pins,
  `.github/workflows/ci.yml:46-48`; gbrain needs at least 1.3.10). Bun is checked the way draft
  PR #160 checks its bundled Node: private copy, digest, thin arm64 Mach-O, system libraries only,
  version probe. `vendor/` is gitignored.
- A tripwire on what can reach out: `tools/brain/egress-surface.json`, committed, lists every
  staged gbrain file that calls `fetch`, `spawn`, `exec`, `execFile`, `Bun.connect`, `WebSocket`
  or imports `net`, `tls`, `http`, `https`, `http2`, `dgram` or `dns`, with its sha256. Staging
  fails when the set or any digest differs. A pin bump regenerates it, so the PR diff shows
  exactly which network- or process-capable files changed, and they are reviewed.
- The brain is its own unit in the install. Today's `verifyRuntime` refuses any file not listed
  in the root `release.json` (`tools/install/runtime-install.mjs:31-40`), and install refuses an
  existing destination (`:53`). A second archive installed into the same directory would either
  collide with the root `release.json` or make the main release fail on every `vendor/` file.
  So the brain archive is the `vendor/` directory with its own `vendor/release.json`: schema
  version, platform, arch, the Foliage version it belongs to, `bunVersion`, `bunSha256`,
  `gbrainVersion`, `gbrainCommit`, `gbrainIntegrity` and every file's sha256, written the way
  `writeRuntimeManifest` writes today's (`tools/deploy/package-local.mjs:12-28`). The root
  check skips `vendor/` only when `vendor/release.json` is present, then verifies `vendor/` as a
  unit against it with the same rules and a matching Foliage version.
  - New install: `node install.mjs <dir> --with-brain <archive>` verifies both archives, copies
    and re-verifies them in one transaction; any failure removes the whole new destination, as
    today (`:54-61`).
  - Adding it to an existing install: `node install.mjs --add-brain <archive> <install>`
    verifies the archive, copies it to `<install>/vendor.next/`, verifies that, and renames it
    to `vendor/`. It refuses when `vendor/` exists; a replacement goes through `vendor.next/`
    and a swap, and removes the old copy only after the swap. Gardens are never touched.
  - Tests: install with and without the brain, adding it later, replacing it, a version
    mismatch refused, one changed byte under `vendor/` refused, and the main install still
    verifying with `vendor/` absent.
- It ships as `foliage-brain-<version>-<platform>-<arch>.tgz`. Without it Foliage works as today
  and says the brain is not installed. The main archive stays about 17 MB and keeps its "no
  bundled interpreter" promise (`tools/deploy/package-local.mjs:48`).
- Sizes: the brain archive is about 82 MB gzipped (gbrain tree 58.5 MB plus bun 23.5 MB,
  measured separately, not built together). On disk, about 306 MB for gbrain and its
  dependencies plus 63 MB for bun once per install, and 42 MB per empty garden brain. Hashing
  the whole tree took 2.6 s warm (measured), so it runs at install and status, not every start.
- A single compiled gbrain binary (`bun build --compile`) was measured broken here: PGLite's
  data and extension bundles are missing from its virtual filesystem
  (`src/core/pglite-engine.ts:171-226`). Revisit only after testing upstream's attested release
  binary. Its size is not measured; the earlier figure of about 32 MB gzipped was an estimate.
- Only macOS arm64 was measured. Linux x64 is built the same way and ships only after it passes
  the same offline test; other platforms get no brain archive and keep today's search.

`Decided 2026-10-12` decision 4 — Ship bun with Foliage, or require users to install it. The
owner replied "Proceed" to the recommendation. **Outcome:** a pinned bun ships inside the
separate brain archive. Hosting that archive as a GitHub release asset, rather than committing it
under `apps/www/public/downloads` like today's archive (an 82 MB file sits close to GitHub's
100 MB per-file limit), is a later owner action; nothing in this unit creates a GitHub release
or uploads an asset. Requiring bun would mean a second runtime for every user and break the
archive's "nothing to download" promise.

**Preflight.** Developer checkout: `tools/install/requirements.mjs` and `preflight.mjs` gain a
bun check with floor 1.3.10. Bun is already needed for `build:bundles` and never checked
(`requirements.mjs:41-47`). User machine, at install and at each brain open: the checks under
"Checked before use", platform and arch (already enforced), and free disk for at least an empty
brain.

**Licence.** gbrain's MIT notice ("Copyright (c) 2026 Garry Tan", `LICENSE:1-3`) ships verbatim
at `vendor/gbrain/LICENSE`, as its terms require for all copies. A generated
`THIRD-PARTY-NOTICES` at the brain archive root lists every staged package's licence with its
LICENSE and NOTICE files: mostly MIT, 51 Apache-2.0 (PGLite also carries the PostgreSQL
licence), ISC, BSD, two Unlicense, one 0BSD, one AFL-2.1 or BSD-3; and bun. Two items need
counsel before release: `libheif-js` is LGPL-3.0 (through `heic-decode`), and the 37 bundled
tree-sitter grammar `.wasm` files carry no licence of their own. Bun's licence and what it links
are listed but not re-checked here. gbrain stays MIT and nothing is relicensed. Foliage's own
licence (PR #85) is still open; this file does not depend on it.

**Egress gate for vendored code.** `scripts/check-egress.mjs` scans only Foliage source in
`apps/*` and `packages/*` and skips `node_modules` (`:89`, `:110-129`). The boundary check, knip
and jscpd do not see `vendor/` either. That is right for a third-party tree, but a scan for
literal hosts cannot vouch for it, so the proof is behavioural, and the observer sits in the
sandbox, not at a proxy. A proxy would never see a request: the spawn function strips
`HTTP(S)_PROXY`. And a refused connection is easy to miss from outside, because gbrain's network
paths fail quietly: the update-check spawn swallows its errors (`src/cli.ts:210-218`), reranking
fails open (`src/core/search/mode.ts:338-347`), and hybrid search drops to keyword without a key.

`scripts/check-brain-offline.mjs` runs the staged gbrain through Foliage's own spawn function
with a throwaway `HOME`, `GBRAIN_HOME` and garden, through build, search, edit, removal and
rebuild. It plants fake keys, `DATABASE_URL`, `OLLAMA_BASE_URL=http://example.test`, a `.env` in
`work/`, a fake `gbrain` on the parent `PATH`, a `.gbrain-source` and `.gbrain-mount` above the
garden, and puts the garden inside a git repo whose `.gitignore` covers `brain/`.

- macOS (the measured harness): `sandbox-exec` with a profile that denies all
  `network-outbound` with `(with send-signal SIGKILL)`, and denies `file-write*` under the real
  `~/.gbrain` and `~/brain`. It denies all outbound, not only IP, because name lookups go
  through the `/private/var/run/mDNSResponder` socket; a plain `network-outbound` deny caught
  curl's lookup there (measured). A denied attempt kills the process at once (exit 137, measured
  for a connect and for a lookup), so gbrain cannot swallow it, and the kernel logs
  `Sandbox: <process>(<pid>) deny(1) network-outbound …` or `deny(1) file-write-…`. The gate
  starts `log stream` before the run and fails on any deny line for a `bun` process during the
  run, which also catches a detached child nobody waits for. `(with report)` is refused on a
  deny rule, and `log show` afterwards did not return these lines in one try while
  `log stream` did (both measured). In the review probe, `init`, `config set`, `import`,
  `search`, `delete_page` and `purge_deleted_pages` ran under this profile with zero deny lines
  (measured).
- Linux (not yet measured): run inside an empty network namespace under
  `strace -f -e trace=connect,sendto,sendmsg`, and fail on any connect that is not loopback and
  on any lookup (port 53 or the resolver's socket). Unprivileged user namespaces can be blocked
  by AppArmor on Ubuntu 24.04 images, so PR 4 measures `unshare -rn` on `ubuntu-latest` and
  falls back to `sudo unshare --net` if needed.
- A negative control, `egress-gate-is-real`, a required job like `boundary-gate-is-real`
  (`.github/workflows/ci.yml:60-89`): stage gbrain, plant a `fetch('http://example.test')` and a
  name lookup in a module every command loads, re-record the digests the way a reviewed pin
  bump would, and require the gate to fail naming the network denial. A digest failure does not
  count.
- A missing `vendor/` or a missing sandbox tool is a red failure with a named cause and the one
  command that fixes it, never a skip, in CI and in a developer's `pnpm check` alike. CI stages
  gbrain before `pnpm check`; that fetch happens on the CI machine, never a user's.
- Where it runs: inside `pnpm check`, on `check-macos` (owner, 2026-10-21). The ubuntu `check`
  job runs `check:portable`, everything but this gate, and fails unless `check-macos` passed, so
  the gate blocks a merge. Measured on ubuntu-latest under strace it took 43 to 73 minutes of
  billed time per run, against about 15 on the Mac. Dependabot's PRs never run on the Mac, so
  this gate does not run for them. The self-hosted macOS runner holds the owner's credentials,
  so the gate never runs without throwaway homes, and the sandbox refuses writes to the real ones.
- "`~/.gbrain` not touched" is shown by the write denial and the empty deny log, not by
  modification times. The owner's own gbrain writes there all day: on 2026-10-10 the directory
  changed at 10:36 and `audit/` that evening (measured). Only `config.json` and `brain.pglite`
  are compared before and after.

The spawn function names no host except loopback, so `check-egress` keeps covering Foliage's
side.

**Words.** `foliage brain status` and `foliage status` print one line: `Brain: current`,
`Brain: behind your record, refreshing`, `Brain: not installed`, `Brain: off`, or
`Brain: broken: <cause>. Run foliage brain rebuild`. A search that falls back says why in the
same words. No count that ranks anything.

## Implementation

Build order. Each PR is small, stands alone and proves one thing.

1. **Excluded hits carry their reason.** `gardenSearchRecords` sets `reason`; `searchRecords`
   returns it as the snippet and the `reason` field, never a body excerpt. This fixes today's
   search on its own, before any brain code. Proves: the 500-character-body test above through
   `foliage search`, `foliage_search` and the private-brain session; public search output is
   unchanged.
2. **Stage, spawn and configure, offline, from a checkout.** `tools/brain/stage-gbrain.mjs`
   (pinned commit and integrity, `--ignore-scripts`, gitignored `vendor/`, `vendor/brain.json`,
   `egress-surface.json` check); `apps/leaf/src/localBrain.ts` part one (spawn function,
   environment allowlist, empty `PATH`, config writer and checker, database settings and their
   read-back, the brain lock); `apps/leaf/brain.mjs` with `foliage brain build|status`; the bun
   check in preflight; the macOS sandbox harness as a focused test. Updates
   `docs/ENGINEERING-PLAN.md:261`. Proves: a brain builds from a garden with the network denied
   and no deny line; the config is exact and the settings read back; a garden inside a git repo
   and under `.gbrain-source` and `.gbrain-mount` files builds every page; the lock is reclaimed
   after a SIGKILL of the Foliage process.
3. **Search, refresh and removal.** `packages/photosynthesis/src/brainPages.ts` (pure:
   `brainRecords`, page projection, slug rule, inert structure lines, refresh plan, and the
   merge of gbrain's slugs with Foliage's own matches); `localBrain.ts` part two (import with
   `--fresh`, removal with purge at 0 hours, the confirm step, rebuild and swap);
   `foliage brain refresh|search|rebuild|remove`. Proves: with at least 10 matching records and a
   current and past-version pair, brain search returns at least what today's search returns;
   a promoted leaflet with third-party provenance is held back; a removal leaves nothing in
   `get_page` with `include_deleted` or in `get_versions`; a newly excluded leaflet rebuilds the
   brain; each structure marker stays inert; a refresh killed at each step converges.
4. **Offline gate in `pnpm check` and CI.** `scripts/check-brain-offline.mjs` with the planted
   switches; the Linux harness measured on `ubuntu-latest`; the `egress-gate-is-real` job; a
   named red failure for a missing `vendor/` or sandbox; CI stages gbrain at the pinned commit
   before `pnpm check`. Proves: every gate run shows zero deny lines and no config drift, and a
   planted fetch or lookup turns it red. Nothing after this PR ships until this gate is required
   and green.
5. **Keep it current.** Refresh after `grow`, `review --resume`, `migrate-queue --apply`,
   `capture`, `share` and `unshare`, after saves in `foliage up`, collection passes and every
   MCP tool that writes; the bounded refresh on read; the 30-second digest check that catches
   other writers of the record, such as a hand edit; the brain line in `foliage status`. Proves: after each real action,
   including an MCP-only session, the brain matches the record; record bytes never change.
6. **`foliage search` and `foliage_search` read the brain** (decision 2).
   `searchLocalGarden` (`apps/leaf/src/localSearch.ts:55-71`) uses `brainRecords`, tries the
   brain first and keeps its identity checks; the `retrieval` field; named fallbacks. Proves:
   existing search and MCP tests pass unchanged with the brain on and off; no forbidden field or
   garden path in output; brain tools, the private-brain session and Canopy search give the same
   output as after PR 1; search latency through the brain is measured.
7. **Ship it.** `tools/deploy/package-brain.mjs`, the bun pin and checks, `vendor/release.json`,
   `install.mjs --with-brain` and `--add-brain`, root verification treating `vendor/` as a unit,
   `LICENSE` and `THIRD-PARTY-NOTICES`, runtime preflight, and `package-local.test.mjs` running
   the installed copy offline. Proves: a clean machine with only Node gets a working brain
   without any download, the brain can be added to an existing install, and a changed byte is
   refused.
8. **Local embeddings, opt-in** (only if decision 3 allows). `foliage brain embed --local
   ollama:<model>` checks that the embedder and model are present and rebuilds the brain at the
   model's dimensions; `embed --stale` on refresh; turning it off rebuilds again. Proves:
   paraphrase recall on the owner's garden is measured against keyword mode; with Ollama stopped,
   search still answers and names the cause; no connection leaves loopback.

Update `context/apps/leaf.md` (storage, runtime, data flow) and `docs/ASSISTANT-MCP.md` (the
`retrieval` and `reason` fields) in the PR that changes each. No host is added to
`public-boundary.json`, and open code never imports `@foliage/photosynthesis-enterprise`, whose
gbrain MCP root declaration stays enterprise.

## Dependencies

- Required units: [02](./02-deployment-package.md), [09](./09-sources-cells.md), [11](./11-achievement-model.md), [12](./12-local-review.md)
- Packages: no new npm dependency in the workspace. gbrain (MIT,
  `github:garrytan/gbrain` at `15b9863d13635d173562a54f55a1d388bfcf546b`, 0.42.73.2) and bun
  1.3.14 are vendored at package time outside the pnpm graph, so pnpm's `minimumReleaseAge` and
  `engineStrict` do not cover them (`pnpm-workspace.yaml:1-11`); the pin, integrity, digests and
  `egress-surface.json` do that job.
- Optional on the user's machine: Ollama or llama-server with an embedding model already
  pulled, only under decision 3.
- Provider inputs: none. No key, account or hosted service.
- Before release: counsel on `libheif-js` (LGPL-3.0), the tree-sitter grammars and bun.

## Verify when done

- [ ] On a real garden, inside the sandbox: `foliage brain build`, then `foliage brain search`,
  returns cited hits; there is no deny line for network or for writes under `~/.gbrain` or
  `~/brain`; `~/.gbrain/config.json` and `~/.gbrain/brain.pglite` are byte-identical before and
  after.
- [ ] After `foliage grow`, a review decision, a promotion, an MCP write and a hand edit of
  `leaf.json`, the manifest digest matches the record within one refresh. A removed record returns nothing from
  `search`, from `get_page` with `include_deleted` and from `get_versions`; a leaflet newly
  marked excluded comes back only as its title and reason, and its old body is in no version.
- [ ] No `score`, `base_score`, gbrain match label, `page_id`, `chunk_id`, `effective_date` or
  garden path in any `foliage search` or `foliage_search` output (grep the JSON); every hit
  carries its label; an excluded hit carries its reason and no body text; for verified and
  pending records with identical text, swapping their tiers does not change their order;
  `list_pages` shows only `foliage/` slugs.
- [ ] For a fixed query set on the test garden and the real garden, brain-answered results
  contain every hit today's search returns, up to the limit.
- [ ] Each switch has a test that tries to turn it back on from the parent environment (keys,
  `DATABASE_URL`, `OLLAMA_BASE_URL`, proxy, `.env`, a gbrain on `PATH`, routing files above the
  garden, a gitignored garden, a planted database base URL) and gets no effect or a named
  refusal.
- [ ] The negative control turns the gate red on a planted fetch and on a planted lookup.
- [ ] Brain missing, behind, busy, misconfigured, or runtime missing: each answers from Foliage's
  own search with the cause, and none returns an empty answer as if nothing matched.
- [ ] `--allow-brain` tools, the private-brain session and Canopy search give the same output as
  after PR 1 on the same fixture.
- [ ] A refresh killed at each step, and a SIGKILL of the Foliage process holding the lock, both
  converge on the next run; `leaf.json` and `harvest.json` bytes never change during brain work.
- [ ] Release: on a clean macOS arm64 machine with only Node, the main and brain archives
  install together, and the brain can also be added to an existing install; build and search
  work with the network denied; one changed byte under `vendor/` is refused; `LICENSE` and
  `THIRD-PARTY-NOTICES` are present.
- [ ] Measured build time, search latency and brain size for the real garden are recorded.
  `pnpm check` is green. The unit stays built-but-unverified until a second person runs it on
  their own machine.

## Shared context

Owner directions, 2026-10-10, verbatim: "wondersearch is no longer an option right now put on
pause. Users are demanding for everything to stay local to their system", then "we are packing
a local version of gbrain only now which we have alreay started or should have completed". No
packaging work existed on `main` when this spec was written. The open plane has no gbrain
integration; the enterprise package declares a gbrain MCP root
(`packages/photosynthesis-enterprise/src/root.ts`, exercised in `root.test.ts`), and
`packages/photosynthesis/src/brainIntake.ts:210` names gbrain's folder convention in a comment.
This unit starts the integration. The `spec/wondersearch-brains` branch is on hold.

Two probes, both 2026-10-10, both of gbrain 0.42.73.2 with no API keys and throwaway `HOME` and
`GBRAIN_HOME`:

- The design probe ran with `env -i` and outbound network denied by `sandbox-exec` with a
  logging proxy (fake keys only in tests that check what a present key does). It measured init
  defaults, import, keyword search, soft deletion, the network paths with planted keys, the
  broken compiled binary and sizes. Its "no connection" result rested on the proxy, which a
  process with proxy variables stripped would not use; the review probe's deny log replaces it.
- The review probe ran the owner's installed gbrain read-only through `env -i`, an empty `PATH`
  and `BUN_RUNTIME_TRANSPILER_CACHE_PATH=0`, under a `sandbox-exec` profile denying all
  `network-outbound` with SIGKILL and all writes under `~/.gbrain` and `~/brain`, with deny lines
  read from `log stream`. It measured the deduplication counts, purge at 0 hours, title search
  and the H1 line, the timeline marker, the gitignored garden, the `.gbrain-source` refusal, the
  empty `PATH`, the transpiler cache, database base-URL removal, the sandbox behaviour above, and
  zero deny lines across every command it ran.

Neither probe wrote to the owner's `~/.gbrain`: the review probe denied writes there and logged
none, and `~/.gbrain/config.json` and `~/.gbrain/brain.pglite` are still dated 2026-08-06. Not measured: local
embedding end to end, recall on a real garden, whether the search switches change behaviour,
PGLite lock contention under load, vacuuming, the Linux harness, Linux and Windows generally,
and whether upstream's `bun.lock` reproduces the measured tree byte for byte.

This replaces the "Seedling — gbrain on PGLite at `~/brain`" line in
`docs/ENGINEERING-PLAN.md:261`, edited in PR 2: the brain lives inside the garden so the
owner's own gbrain and notes are never touched. B03 because it finishes part of the individual's
local repeat-use journey and needs no hosted package. In the release ladder
(`.loop/MILESTONES.md`) it belongs to gate 1, private record and brain, as current work.

Numbering: `spec/team-portfolio-local` also claimed unit 38. Integrated together, this unit keeps
38, the team project portfolio is [unit 39](./39-team-project-portfolio.md) and release acceptance
is [unit 40](./40-release-acceptance.md).

Raised for the owner under the local-only rule, outside this unit and not decided here: the
private-brain session can serve over a non-loopback bind with TLS
(`apps/leaf/private-brain.mjs:111-120`); MCP results go to whatever model the agent host runs,
often a cloud one; and the open plane still declares `api.typesafe.ai` and `api.fireworks.ai`
(`public-boundary.json:88-89`).

The four owner choices were decided on 2026-10-12, when the owner replied "Proceed" to the
recommendations. One question stays open: whether text from an excluded leaflet still present
under its draft or a past version must force a rebuild (under decision 1).
