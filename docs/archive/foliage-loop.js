export const meta = {
  name: 'foliage-loop',
  description: 'The Foliage engineering loop. One slice per run: Frame (tree identity + baseline + the slice as an executable contract, justified against .loop/PRODUCT.md) -> Build (parallel lanes, strict disjoint file ownership) -> Integrate (the seam, in the REAL running app, `pnpm verify`) -> Adversary (independent model, falsify) -> Reconcile (.loop/STATUS.md row + .loop/state.json cursor, together, then the per-lane snapshots). Only Reconcile writes history — parallel lanes doing it race .git/index.lock and empty the git status the ownership audit reads, measured — and nothing is ever pushed.',
  whenToUse: 'Every build iteration on Foliage. Run with no args to let Frame select from PRODUCT.md + STATUS.md, or pass { slice, lanes: [{key,owns,brief}] } to define it by hand.',
  phases: [
    { title: 'Frame', detail: 'confirm WHICH tree, capture the dirty-file baseline, and state the slice as a contract justified against the current milestone' },
    { title: 'Build', detail: 'builder lanes, parallel only while their file ownership is provably disjoint' },
    { title: 'Integrate', detail: 'the seam — exercised in the real running app, with `pnpm verify` evidence quoted' },
    { title: 'Adversary', detail: 'read-only, on a DIFFERENT model: try to falsify what the lanes claim' },
    { title: 'Fix', detail: 'bounded repair of blocking defects only — this phase WRITES, which is why it is not part of Adversary' },
    { title: 'Reconcile', detail: 'ledger row + cursor, atomically, recording only what was observed' },
  ],
}

/* ── WHY THE HIERARCHY IS THIS SHAPE ───────────────────────────────────────────────────────
 * FRAME      exists because the previous draft of this loop hardcoded a repo path pointing at
 *            a DIFFERENT worktree on a DIFFERENT branch. Every lane would have built the right
 *            thing in the wrong tree and reported success. So the run now starts by proving
 *            which checkout it is standing in, and it also records `git status --porcelain`
 *            BEFORE any lane runs — without that baseline, "did a lane edit outside its lane?"
 *            is unanswerable, because this tree already carries unrelated untracked work.
 * BUILDER    owns an explicit file list and nothing else. Lanes run in PARALLEL only while the
 *            ownership sets are provably disjoint — two agents editing one file in a shared
 *            worktree corrupt each other, measured twice in this lineage. The overlap check
 *            below is mechanical, not a request in a prompt.
 * INTEGRATOR owns the seam. Runs AFTER the builders because it needs both halves. Its
 *            deliverable is the REAL running app, not a passing test.
 * ADVERSARY  read-only, and on a DIFFERENT MODEL. Same-model review is adversarial but it is
 *            not independent, and .loop/LOOP.md gate 6 requires the distinction be stated.
 * RECONCILER updates the ledger row AND the cursor in the same step. It may only record what
 *            was actually observed, and never a row it did not verify.
 * ───────────────────────────────────────────────────────────────────────────────────────── */

/* PARSED, THEN CHECKED IT IS AN OBJECT — the second half is the one that matters and it was
 * missing until 2026-08-20, when a concurrent session on another branch hit it and wrote it down.
 * `JSON.parse` happily returns a string, a number, or null, and none of those was rejected here:
 *
 *   args '"a-slice"'  ->  ARGS is the STRING "a-slice", so `ARGS.slice` resolves to
 *                         String.prototype.slice — a truthy FUNCTION. The run then proceeds with a
 *                         function as its slice, and that session measured the consequence: zero
 *                         builders ran and the run reported success.
 *   args 'null'       ->  ARGS is null and `ARGS.slice` THROWS at module top level, killing the
 *                         whole workflow before phase 1, with no log and no agents.
 *
 * Both verified in this tree before the fix. An array is refused too: `args: ["a","b"]` would give
 * `.slice` the same way. Anything that is not a plain object is not arguments. */
let ARGS = {}
const usable = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
if (typeof args === 'string') {
  let parsed = null
  try { parsed = JSON.parse(args) } catch { parsed = undefined }
  if (parsed === undefined) log(`args was a string but not JSON (${args.slice(0, 80)}) — ignoring it; Frame will select the slice.`)
  else if (!usable(parsed)) log(`args parsed to a ${parsed === null ? 'null' : Array.isArray(parsed) ? 'array' : typeof parsed}, not an object — ignoring it; Frame will select the slice.`)
  else ARGS = parsed
} else if (usable(args)) ARGS = args
else if (args !== undefined && args !== null) log(`args was a ${Array.isArray(args) ? 'array' : typeof args}, not an object — ignoring it.`)
const SLICE_IN = ARGS.slice ?? null
const LANES_IN = Array.isArray(ARGS.lanes) ? ARGS.lanes : null
const REVIEW_MODEL = ARGS.reviewModel === undefined ? 'sonnet' : ARGS.reviewModel
const FIX_ROUNDS = ARGS.fixRounds === undefined ? 1 : ARGS.fixRounds
// 'reconcile' (default): the RECONCILER commits, nobody else. 'off': the run ends dirty and a human
// stages it — correct for an attended run, WRONG for the scheduled one, because .loop/run-once.sh:58
// declines to start on a dirty tree, so a run that ends dirty blocks every run after it.
const COMMIT = ARGS.commit === undefined ? 'reconcile' : ARGS.commit
// No repo path is hardcoded ON PURPOSE. Agents inherit this session's cwd; Frame proves it is
// the right tree and every later phase is handed the toplevel it confirmed. A committed
// absolute home path is also a username disclosure. Override only for a deliberate cross-tree run.
const REPO_HINT = ARGS.repo ?? null

const CHARTER = `
GIT, AND WHICH ROLE MAY WRITE HISTORY — read this before you touch the tree:
- NOTHING IS EVER PUSHED. Not by any role, not for any reason. No force-push, no branch change,
  no reset, no stash. That is the boundary; everything inside it is local and reversible.
- YOUR LANE LEAVES ITS WORK IN THE WORKING TREE and reports its paths. Only the RECONCILER
  writes history, at the end. Two mechanisms force that, rather than a preference: (1) lanes run
  in PARALLEL in ONE worktree and concurrent git writes race \`.git/index.lock\`, so one lane's
  staged paths land in another's snapshot; (2) recording a change REMOVES its files from
  \`git status --porcelain\`, which is the exact evidence the ownership audit diffs against the
  Frame baseline — a lane that records its own work erases the proof of what it touched. That is
  what happened last run (f3ac6f2, 1be68a5, both from builder lanes): the audit ran and saw
  nothing. Never \`git add -A\`; stage explicit paths you can name.
- Never call an interactive tool (AskUserQuestion and friends). It is FATAL here — the harness
  kills the whole run and your work is lost. A decision goes in your returned TEXT: pick the
  safest reversible default and report it with the alternatives you weighed; if it is genuinely
  owner-gated, return "BLOCKED — needs owner decision:" and the options, as text.
- DELEGATION CAP: you do not spawn subagents. Do the work yourself.

REPO: the CURRENT WORKING DIRECTORY. Do not cd anywhere else, and do not trust a path from
memory — this project has more than one checkout on more than one branch, and a previous
version of this loop pointed at the wrong one.
${REPO_HINT ? `The caller asserts the repo is: ${REPO_HINT} — confirm it, do not assume it.` : ''}

READ FIRST: AGENTS.md (the contract), .loop/LOOP.md (this loop's contract of record),
.loop/PRODUCT.md (what "next" means), docs/ENGINEERING-PLAN.md (why the code is this shape),
public-boundary.json.

NON-NEGOTIABLES (breaking one fails the lane):
- NO FAKE DATA. If real data does not exist, build the path and show the honest EMPTY state.
  A surface backed by fixtures is at most PARTIAL and must say so on its face.
- NO SCORE. ProofTier is unordered — no comparator, weight, percentage or composite. The
  SCORE_SHAPED list is exported from @foliage/leaf and refused BY NAME by every gate,
  \`confidence\` included. That means no confidence field in a MODEL'S OUTPUT SCHEMA either.
- EVERY FIELD IN EVERY SCHEMA SENT TO A MODEL IS NULLABLE. A constrained decoder cannot
  decline: a required field whose answer is absent from the source leaves the grammar no way
  to say so, so the model fabricates. Measured — packages/photosynthesis/src/photoIntake.ts.
  Drop nulls rather than storing them.
- A FAILURE IS NEVER A ZERO. Discriminated unions with named causes; when a fallback exists,
  report BOTH causes. A function collapsing "no git" / "not a repo" / "timed out" / "no
  commits" into 0 makes the product assert things about work it never read.
- AI OUTPUT IS NEVER PROOF. A synthesized thing is a CANDIDATE; promotion writes \`pending\`
  unconditionally. Nothing crosses the harvest→leaf seam except what a human approved, and no
  extraction metadata crosses it at all.
- NEVER SHIP A SILENT REWRITER. Detect, report, refuse — never quietly alter evidence. A
  mature PII redactor over 800 real commit subjects altered 12 lines, 11 of them false positives.
- ATTRIBUTION IS DECLARED, NEVER INFERRED. One human commits under seven identity strings in
  one real repo; unmatched work is \`excluded\` WITH A REASON, never guessed, never dropped.
- NEW DISTINCTIONS RIDE BESIDE THE TIER, never inside it. Signature findings, freshness,
  co-attribution: the tier set is FCRA-scoped and growing it changes what the product claims.
- THE PLANE BOUNDARY IS MECHANICAL. \`pnpm check:boundary\` must pass; \`open\` may not reach
  \`cloud\`/\`enterprise\`. Zero third-party runtime dependencies. No build step, no dist/ —
  Node 22 strips types and runs the .ts directly. If an import fails the specifier is wrong,
  not the toolchain.
- DOMAIN vs APP: rules about what evidence MEANS live in packages/* (pure, total, no fs, no
  network, no clock, no throw). Subprocess/fs/network live in apps/*.
- LOOPBACK IS ENFORCED ON THE PARSED HOSTNAME so an edit to a constant fails closed. Loopback
  proves the connection does not leave the machine, not that the bytes stop there — say so.
- DESIGN: use @foliage/tokens, never a copied value. Accent at most twice per screen. Metrics
  in mono tabular-nums. Bordered cells over floating cards, small radii, no box shadows.
  Motion never bounces. State MEASURED contrast WITH the px size it is judged at; never assert
  AA. (4.10:1 once passed review because a 3:1 large-text threshold was applied to an 11px
  label, which needs 4.5:1. Correct arithmetic, wrong reference.)
- **IF YOUR LANE RENDERS ANYTHING, READ \`CLAUDE.md\` FIRST — it is the UI contract and it
  overrides your instincts here.** Measured 2026-08-19: one page carried 4,264 words and 187
  sentences over eight words long, because this repo's comment discipline (say WHY, name the trap)
  is right in a .ts file and wrong in rendered HTML. **Show the fact, offer the explanation, never
  assert it.** A label not a sentence; a sentence not a paragraph; rationale lives in docs. A user
  must be able to use the surface WITHOUT READING. Cutting text must never cut a caveat —
  RELOCATE, never delete — and anything whose absence would MISLEAD stays visible, always
  including the fabrication band and the example-document marker. Count the words on the rendered
  page before and after and state both numbers.
- Tests are \`node --test\`, colocated, exercising REAL behaviour on REAL files.
- Match the surrounding voice: say WHY, name the trap, record the measurement.

CONTEXT COMES FROM RETRIEVAL, NOT SCANNING. The vault is ~318k tokens; a good pack is ~4.5k.
  pnpm vault:ask "<question>" --budget 6000     prose, decisions, history (~20ms, no model)
  graphify affected "<symbol>"                  code impact — SYMBOLS ONLY, never prose
Report what you retrieved and from where.

BROWSER EVIDENCE IS ONE COMMAND:
  pnpm verify                 every surface: boots it, checks headers, drives the browser
  pnpm verify photosynthesis  just one   (surfaces: leaf 4174, canopy 4173, photosynthesis 4177)
It settles the page (fonts ready, zero running animations) and returns contrast measured at each
element's own px size, heading outline, overflow, counts, and score-shaped-text sightings — about
1.5s for all three. It caught a page naming three typefaces and serving none, which three prior
verification passes and a 13-agent review had all missed. If you must drive BrowserOS neo directly
for something \`verify\` does not cover: name_session FIRST, \`tabs action="new"\` EXACTLY ONCE, then
\`navigate\` that same page id for every URL, and close your tabs before you finish. One run leaked
~120 tabs into the human's own browser where nobody can ever close them.

GATE: \`pnpm check\` (boundary → typecheck → tests) green before you finish. Non-interactive and
timeout-wrapped — a check may FAIL but must never HANG: \`timeout 180 pnpm test\`, \`curl -s -m5\`,
never a foreground dev server. Piping to head/tail makes $? the pipe's status: \`cmd > log 2>&1; echo $?\`.
A wrong \`--filter\` prints "No projects matched the filters" and exits 0 — never trust a filtered
command you have not seen produce real output.

SCOPE: touch ONLY the files your lane owns. Other agents share this worktree.
`

const FRAME_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['toplevel', 'branch', 'head', 'baseline', 'slice', 'ledgerRow', 'milestoneJustification', 'lanes', 'integrateBrief', 'blocked'],
  properties: {
    toplevel: { type: 'string', description: 'git rev-parse --show-toplevel, verbatim' },
    branch: { type: 'string' },
    head: { type: 'string' },
    baseline: { type: 'string', description: 'git status --porcelain BEFORE any lane runs, verbatim. This is what tells a later phase which dirt was already here.' },
    slice: { type: 'string', description: 'the slice as an executable contract: what must be TRUE when it is done' },
    ledgerRow: { type: ['string', 'null'], description: 'the .loop/STATUS.md row id this serves, or null if it needs a new row' },
    milestoneJustification: { type: 'string', description: 'one sentence tying this slice to the CURRENT MILESTONE in .loop/PRODUCT.md. If the mechanically top row does not serve the milestone, say so and pick the one that does.' },
    lanes: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['key', 'owns', 'brief'],
        properties: {
          key: { type: 'string' },
          owns: { type: 'array', items: { type: 'string' }, description: 'exact repo-relative paths. Disjoint across lanes — this is checked mechanically, not trusted.' },
          brief: { type: 'string' },
        },
      },
    },
    integrateBrief: { type: 'string', description: 'what the seam is, and which surface proves it' },
    blocked: { type: ['string', 'null'], description: 'non-null ONLY if the run cannot proceed — wrong tree, or the slice needs an owner decision first. Name it.' },
  },
}

const BUILD_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['lane', 'shipped', 'filesEdited', 'testEvidence', 'honestState', 'handoff', 'decisions'],
  properties: {
    lane: { type: 'string' },
    shipped: { type: 'string' },
    filesEdited: { type: 'array', items: { type: 'string' } },
    testEvidence: { type: 'string', description: 'Exact command + exact pass/fail counts, as printed.' },
    honestState: { type: 'string', description: 'VERIFIED-WORKING / BUILT-BUT-UNVERIFIED / PLUMBING-ONLY, and what is NOT proven.' },
    handoff: { type: ['string', 'null'], description: 'Every exported signature another lane depends on, verbatim — or null if this lane exported nothing new. (The fixer reuses this schema and usually exports nothing; a required string here would make it invent one.)' },
    decisions: { type: ['string', 'null'], description: 'Reversible calls you made and the alternatives weighed; or an owner-gated question you could not resolve. Text, never an interactive tool.' },
  },
}

const INTEGRATE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['works', 'realRunEvidence', 'verifyOutput', 'mismatches', 'filesEdited', 'suiteState', 'ownershipViolations', 'head'],
  properties: {
    works: { type: 'string', enum: ['composes', 'does-not-compose', 'not-exercised'], description: 'not-exercised means you could not drive the seam AT ALL — never report that as does-not-compose. A failure is never a zero.' },
    realRunEvidence: { type: 'string', description: 'Verbatim terminal/HTTP output from the real running app, through the real user path.' },
    verifyOutput: { type: ['string', 'null'], description: 'Verbatim `pnpm verify` output, or null with the reason no surface applies to this slice.' },
    mismatches: { type: 'array', items: { type: 'string' } },
    filesEdited: { type: 'array', items: { type: 'string' } },
    suiteState: { type: 'string' },
    ownershipViolations: { type: 'array', items: { type: 'string' }, description: 'Files changed that no lane owned, computed against the Frame baseline AND against git log since the Frame HEAD. Empty is a claim you must have checked.' },
    head: { type: 'string', description: 'git rev-parse HEAD after your work, verbatim. It MUST equal the Frame HEAD — no lane writes history. If it moved, a lane did: name which files left git status because of it, since the ownership audit could no longer see them.' },
  },
}

const VERDICT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['defects', 'overclaims', 'suiteState', 'independence', 'verdict'],
  properties: {
    defects: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['file', 'line', 'defect', 'failureScenario', 'severity'],
        properties: {
          file: { type: 'string' }, line: { type: 'number' }, defect: { type: 'string' },
          failureScenario: { type: 'string' },
          severity: { type: 'string', enum: ['blocking', 'should-fix', 'minor'] },
        },
      },
    },
    overclaims: { type: 'array', items: { type: 'string' } },
    suiteState: { type: 'string' },
    independence: { type: 'string', description: 'State plainly whether you ran on a different model than the builders. If the same, say the review is adversarial but NOT independent.' },
    verdict: { type: 'string', enum: ['SHIP', 'FIX-FIRST', 'REJECT'] },
  },
}

/* Ownership overlap is decided HERE, in code, not asked for in a prompt. Prefix-containment
 * catches the real case — one lane owning `packages/leaf/src` while another owns a file
 * inside it — which a string-equality check would wave through. */
/* Context handed forward is CLIPPED PER ITEM, never stringified whole and cut. Measured in run
 * wf_82020e78-3b8, this exact script: {built,integrated,fixes,verdict} serialized to 84,193 chars
 * and `.slice(0, 14000)` landed inside built[0] — so the Reconciler never saw the seam evidence
 * OR the adversary's verdict, marked the row DONE on the builders' self-reports, and the string it
 * did get ended mid-word. JSON.stringify preserves insertion order, so the LAST key truncates
 * first, and in every one of the three call sites the last key was the one the receiving agent was
 * told to act on. That is a failure rendering as an empty success — the class this loop exists to
 * catch. The budget is unchanged; what changes is that the boundary is now visible and per-item. */
const clip = (v, n) => {
  const s = JSON.stringify(v, null, 1)
  return s.length <= n ? s : `${s.slice(0, n)}\n[TRUNCATED — ${s.length - n} of ${s.length} chars withheld. Absence here is NOT "the lane did not say it"; ask for what you need.]`
}
const digest = (rs) => rs.map((r) => clip(r, 4500)).join('\n')

const norm = (p) => String(p).replace(/^\.\//, '').replace(/\/+$/, '')
const collides = (a, b) => a === b || a.startsWith(b + '/') || b.startsWith(a + '/')
function overlapsIn(lanes) {
  const out = []
  for (let i = 0; i < lanes.length; i++) {
    for (let j = i + 1; j < lanes.length; j++) {
      for (const a of (lanes[i].owns ?? []).map(norm)) {
        for (const b of (lanes[j].owns ?? []).map(norm)) {
          if (collides(a, b)) out.push(`${lanes[i].key}:${a} ↔ ${lanes[j].key}:${b}`)
        }
      }
    }
  }
  return out
}

phase('Frame')
const frame = await agent(`${CHARTER}

# FRAME — which tree, what is already dirty, and what exactly is the slice

Do these in order and report each verbatim:

1. \`pwd && git rev-parse --show-toplevel && git rev-parse --abbrev-ref HEAD && git log --oneline -1\`
   If the toplevel is not a Foliage checkout (AGENTS.md, public-boundary.json, .loop/ all present),
   set \`blocked\` and STOP. Building the right thing in the wrong worktree is the specific failure
   this phase exists to prevent.
2. \`git status --porcelain\` — record it VERBATIM as the baseline. This tree already carries
   unrelated untracked work; without this, no later phase can tell a lane's edit from pre-existing dirt.
3. Run \`node tools/loop/findings.mjs --select\` and paste it. THIS COMES BEFORE THE LEDGER.
   A finding is a defect an adversary already PROVED in shipped code, and debt outranks new work:
   \`BROKEN > DARK > PARTIAL > TODO > BUILT\` orders capabilities, and this orders damage. The link
   it closes is the one this loop was missing — run 2 found a blocking defect, recorded it
   honestly, kept the row off DONE, and then advanced the cursor to an unrelated capability. The
   loop detected and reported; nothing scheduled the fix. That was the gap.
4. Read .loop/PRODUCT.md, then .loop/STATUS.md. PRODUCT before ledger is an owner directive:
   the loop twice produced immaculate rows while the product went nowhere.

${SLICE_IN ? `THE SLICE IS GIVEN — do not substitute your own: ${SLICE_IN}
Restate it as an executable contract and justify it against the current milestone anyway. If it
does not serve the milestone, say so plainly in milestoneJustification and still proceed.` :
`NO SLICE WAS GIVEN — select one, in this order:
(a) If \`findings.mjs --select\` named an OPEN or UNGUARDED finding, THAT IS THE SLICE. Fix it, and
    the slice is not complete until a test fails when the fix is reverted — say in your contract
    which test that will be. A finding is a defect someone already reproduced; leaving it to take a
    fresh capability is how this repository accumulated three of them in two days.
(b) Otherwise take the highest-priority incomplete ledger row (BROKEN > DARK > PARTIAL > TODO >
    BUILT) that serves the CURRENT MILESTONE in PRODUCT.md. If the mechanically top row does not
    serve the milestone, say so and select the row that does.`}

${LANES_IN ? `THE LANES ARE GIVEN — adopt them VERBATIM, do not invent others:
${JSON.stringify(LANES_IN, null, 2)}` :
`DECOMPOSE into 2–4 builder lanes with STRICTLY DISJOINT file ownership. \`owns\` is exact
repo-relative paths, not descriptions — the overlap check is mechanical and a vague path fails it.
Domain rules (pure, total) live in packages/*; subprocess, fs and network live in apps/*, so that
split is usually where the lane boundary already is.`}

Then say what the SEAM is: which surface, driven how, proves the lanes actually compose.
Do not write any product code in this phase.`,
  { label: 'frame:slice', phase: 'Frame', effort: 'high', schema: FRAME_SCHEMA })

if (!frame) return { error: 'Frame returned nothing — nothing was built. Re-run.' }
if (frame.blocked) {
  log(`BLOCKED at Frame: ${frame.blocked}`)
  return { blocked: frame.blocked, frame }
}
log(`tree: ${frame.toplevel} @ ${frame.branch} ${frame.head}`)
log(`slice: ${frame.slice}`)

const lanes = frame.lanes ?? []
if (lanes.length === 0) return { error: 'Frame produced no lanes.', frame }

const collisions = overlapsIn(lanes)
if (collisions.length > 0) {
  log(`OWNERSHIP OVERLAP — running lanes SEQUENTIALLY instead of in parallel: ${collisions.join('; ')}`)
}

const LANE_CONTEXT = (l) => `${CHARTER}

# BUILDER LANE — ${l.key}

TREE (confirmed by Frame): ${frame.toplevel} @ ${frame.branch} ${frame.head}
SLICE: ${frame.slice}
WHY THIS SLICE: ${frame.milestoneJustification}
LEDGER ROW: ${frame.ledgerRow ?? '(none yet — say so in your report; do not edit the ledger)'}

YOU OWN EXACTLY THESE PATHS AND NOTHING ELSE:
${(l.owns ?? []).map((p) => `  - ${p}`).join('\n')}
Other lanes own the rest of this slice and are editing this same worktree. Editing outside your
list corrupts their work and is detected afterwards by diffing against the Frame baseline.

${l.brief}

Report your exported signatures verbatim in \`handoff\` — another lane is compiling against them.`

phase('Build')
let built
if (collisions.length > 0) {
  built = []
  for (const l of lanes) {
    const r = await agent(LANE_CONTEXT(l), { label: `build:${l.key}`, phase: 'Build', effort: 'high', schema: BUILD_SCHEMA })
    if (r) built.push(r)
  }
} else {
  built = (await parallel(lanes.map((l) => () =>
    agent(LANE_CONTEXT(l), { label: `build:${l.key}`, phase: 'Build', effort: 'high', schema: BUILD_SCHEMA })
  ))).filter(Boolean)
}
log(`builders: ${built.length}/${lanes.length}${collisions.length > 0 ? ' (sequential)' : ''}`)
if (built.length === 0) return { error: 'No builder lane returned anything — there is nothing to integrate.', frame }

const OWNERSHIP_MAP = lanes.map((l) => `${l.key} owns: ${(l.owns ?? []).join(', ')}`).join('\n')

phase('Integrate')
const integrated = await agent(`${CHARTER}

# INTEGRATOR — you own the SEAM

TREE: ${frame.toplevel} @ ${frame.branch}
SLICE: ${frame.slice}
SEAM: ${frame.integrateBrief}
Builder reports (each clipped separately, so no lane can be amputated by another's length):
${digest(built)}

${ARGS.integrate ?? ''}

Your deliverable is NOT a passing test. It is the REAL running app exercised through the REAL user
path on REAL data, with verbatim evidence. A passing test against a fixture proves the pipe, not the
water. Boot the surface, drive it, paste what you saw. Run \`pnpm verify\` (or \`pnpm verify <surface>\`)
and paste its output; if no surface applies to this slice, say why rather than leaving it null silently.

If the lanes do not actually compose, say so plainly and name the mismatch — do NOT paper over it.

OWNERSHIP AUDIT — do this, it is not optional. Run \`git status --porcelain\` AND
\`git log --name-only --oneline ${frame.head}..HEAD\`, and diff BOTH against the Frame baseline below.
Both, because a commit made during this run REMOVES its files from \`git status\` entirely — the
porcelain diff alone is blind to the one event most worth catching, and the last run produced two
commits nobody noticed. Report the HEAD you end on. Anything changed that no lane owned goes in \`ownershipViolations\` with the lane
that most likely did it. An empty array is a claim you have to have earned.

  LANE OWNERSHIP:
${OWNERSHIP_MAP}

  FRAME BASELINE (already-dirty BEFORE any lane ran — these are NOT violations):
${frame.baseline}`,
  { label: 'integrate:seam', phase: 'Integrate', effort: 'high', schema: INTEGRATE_SCHEMA })

if (!integrated) log('INTEGRATE PRODUCED NOTHING — the seam was never exercised. Nothing this run may be recorded above BUILT.')
else if (integrated.works !== 'composes') log(`SEAM ${integrated.works.toUpperCase()}: ${(integrated.mismatches ?? []).join('; ') || '(no mismatch named)'}`)
if (integrated?.ownershipViolations?.length) log(`OWNERSHIP VIOLATIONS: ${integrated.ownershipViolations.join('; ')}`)

const ADVERSARY_PROMPT = (claims) => `${CHARTER}

# ADVERSARY — READ-ONLY. Falsify, do not admire. Default to finding a problem.

TREE: ${frame.toplevel} @ ${frame.branch}
SLICE: ${frame.slice}
SEAM (the integrator's own claims — falsify these too, not just the lanes'):
${clip(claims.integrated, 6000)}

LANES:
${digest(claims.built)}${claims.fixes ? `\n\nFIXES APPLIED SINCE YOUR LAST PASS:\n${digest(claims.fixes)}` : ''}

${ARGS.verify ?? ''}

Attack in this order, and RUN things rather than reading them:
1. FABRICATION — any path where something is asserted that nobody observed. Any model schema field
   that is not nullable (a constrained decoder cannot decline, so it invents). Any score-shaped key.
2. A FAILURE THAT RENDERS AS AN EMPTY SUCCESS — read errors, permission denials, partial reads,
   a total function collapsing distinct causes into one zero value.
3. EGRESS — anything reaching a third party from a surface that claims zero network calls.
   Check resource origins, fonts, and that loopback is enforced on the PARSED hostname.
4. THE BOUNDARY — \`pnpm check:boundary\`, added dependencies, domain/app confusion (fs, network,
   clock or throw inside packages/*).
5. TESTS THAT CANNOT FAIL — read the assertions and ask what would still pass if the code were wrong.
6. THE CLAIMS THEMSELVES — re-run the lanes' own commands and confirm their numbers EXACTLY. A wrong
   count is itself a finding; this ledger has been wrong four times from copied numbers.

The orchestrator dispatched the builders on the session default and dispatched YOU with
model: ${REVIEW_MODEL || '(none — the same default as the builders, so this review is NOT independent)'}.
Record THAT in \`independence\`; do not infer your own model from the code's voice. Report file:line for
everything. Style preferences are not defects. Do not edit any file.`

/* One definition of the adversary's dispatch. Written twice, the recheck could drift onto the
 * builders' model while the first pass stayed cross-model, silently voiding LOOP.md gate 6. */
const adversaryOpts = (label) => ({
  label, phase: 'Adversary', effort: 'high',
  ...(REVIEW_MODEL ? { model: REVIEW_MODEL } : {}),
  schema: VERDICT_SCHEMA,
})

phase('Adversary')
log(REVIEW_MODEL ? `adversary dispatched on '${REVIEW_MODEL}'` : 'adversary on the DEFAULT model — same as the builders, so this review is adversarial but NOT independent')
let verdict = await agent(ADVERSARY_PROMPT({ built, integrated }), adversaryOpts('adversary:falsify'))
if (!verdict) log('ADVERSARY PRODUCED NOTHING — nothing was falsified. No row may be recorded DONE this run.')

/* One bounded fix round. Unbounded would let a lane and its reviewer argue forever; zero would
 * leave a known blocking defect sitting in the tree for the ledger to record as a blocker. */
let fixes = []
let round = 0
while (verdict && verdict.verdict === 'FIX-FIRST' && round < FIX_ROUNDS) {
  const blocking = (verdict.defects ?? []).filter((d) => d.severity === 'blocking')
  if (blocking.length === 0) break
  round++
  log(`fix round ${round}: ${blocking.length} blocking defect(s)`)
  const fix = await agent(`${CHARTER}

# FIXER — blocking defects only, round ${round}

TREE: ${frame.toplevel} @ ${frame.branch}
SLICE: ${frame.slice}

Fix EXACTLY these and nothing else. Do not refactor, do not widen scope, do not fix the
should-fix or minor findings — they belong in the ledger row as named blockers, not in this diff.

${blocking.map((d) => `- ${d.file}:${d.line} — ${d.defect}\n  fails when: ${d.failureScenario}`).join('\n')}

If a finding is WRONG, do not "fix" it — say so with the evidence that refutes it. An adversary
being wrong is a normal outcome and pretending otherwise puts a fabricated fix in the tree.
Re-run \`pnpm check\` and paste the result.`,
    { label: `fix:round${round}`, phase: 'Fix', effort: 'high', schema: BUILD_SCHEMA })
  if (fix) fixes.push(fix)
  verdict = await agent(ADVERSARY_PROMPT({ built, integrated, fixes }), adversaryOpts(`adversary:recheck${round}`))
}

phase('Reconcile')
const reconciled = await agent(`${CHARTER}

# RECONCILER — the ledger, and ONLY what was actually observed

TREE: ${frame.toplevel} @ ${frame.branch}
SLICE: ${frame.slice}
LEDGER ROW: ${frame.ledgerRow ?? '(none — add one only if this slice is genuinely a new capability)'}
ADVERSARY VERDICT: ${verdict?.verdict ?? 'NONE — the adversary produced nothing, so nothing was falsified and NO row may be recorded DONE'}
UNFIXED FINDINGS (carry these into the row as named blockers):
${clip((verdict?.defects ?? []).filter((d) => d.severity !== 'minor'), 4000)}
INDEPENDENCE: ${verdict?.independence ?? '(unknown)'}
OVERCLAIMS THE ADVERSARY CAUGHT: ${clip(verdict?.overclaims ?? [], 2500)}

SEAM: ${integrated ? clip(integrated, 6000) : 'NONE — Integrate produced nothing. The seam was never exercised; nothing may be recorded above BUILT.'}

LANES:
${digest(built)}${fixes.length ? `\n\nFIXES:\n${digest(fixes)}` : ''}

YOU OWN: .loop/STATUS.md, .loop/state.json and .loop/FINDINGS.md. Those are the only files you EDIT.

FIRST, BEFORE THE LEDGER: append every BLOCKING or SHOULD-FIX finding the adversary left UNFIXED to
.loop/FINDINGS.md, one row each, with the next free F-NNN id. Status is \`open\` if it was not fixed,
\`unguarded\` if a fixer fixed it but no test would catch its return, \`guarded\` only when you can name
the test file. Copy the adversary's REPRO into the row — a finding without the reproduction is a
rumour, and the next run has to be able to re-trigger it without re-deriving it.

This is the link the loop was missing and it is worth stating why. On 2026-08-19 an adversary proved
a blocking defect, the reconciler correctly kept the row off DONE, and the cursor then advanced to an
unrelated capability. Detection worked, recording worked, and nothing scheduled the repair — so the
defect survived on the honesty of whoever happened to read the journal. Writing it here is what makes
the next SELECT see it, because SELECT now reads \`findings.mjs --select\` before the ledger.

Then run \`node tools/loop/findings.mjs\` and paste it. A fix you shipped without a test is
\`unguarded\` and the gate fails on it — do not relabel it \`guarded\` to go green; that is the exact
move the file exists to refuse.

MODE: ${COMMIT}. ${COMMIT === 'reconcile'
  ? `You are the only role that records history, and you do it AFTER the ledger is written. One
snapshot per lane using that lane's own explicit paths — never \`git add -A\`, never a path you
cannot name — and the .loop/STATUS.md row and .loop/state.json cursor go together in one, because
.loop/LOOP.md:120 requires that atomicity and the previous loop's cursor froze for a day without
it. Match the repository's subject voice: lowercase \`area(ROW): what changed and why it mattered\`,
no trailing period, and DO carry the \`Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>\`
trailer the repository's history uses on every commit — this brief asserted the opposite until
2026-08-19, from a habit rather than from \`git log\`. NEVER push. If \`pnpm check\` is not green, leave the
lane that broke it in the working tree and say so in the row instead.`
  : `Do NOT record anything; leave the tree dirty for a human to stage. Note that
.loop/run-once.sh:58 declines to start on a dirty tree, so if the scheduler launched this run, the
next hour will decline.`}

Update the ledger rows this slice touched, in the ledger's own vocabulary
(DONE / BUILT / PARTIAL / DARK / BROKEN / TODO / GATED) and its own discipline:
- \`DONE\` means a user can use it in the real running app, verified end to end with evidence from
  THIS run. If the adversary returned FIX-FIRST or REJECT, the row is NOT DONE.
- \`BUILT\` is not \`DONE\`, and a surface backed by fixtures is at most \`PARTIAL\` and its row says which
  part is fixture-bound.
- Record counts WITH the date they were observed. A bare number is a present-tense claim, and this
  ledger has been wrong four times from copied numbers.
- Set \`last verified\` to today ONLY for rows you have evidence for. DO NOT touch a row you did not
  verify — a row cleared without evidence is the exact corruption the ledger exists to refuse.
- Carry the adversary's UNFIXED findings into the row as a named blocker rather than omitting them.
- Then advance .loop/state.json in the SAME step: iteration, lastCapability, nextSeed, and a
  \`$nextSeedReason\` that justifies the next row against .loop/PRODUCT.md. The row and the cursor
  move together — the previous loop kept them apart and the cursor froze at iteration 12 while a
  day of work landed only in the ledger.

Then run \`node tools/launch/status.mjs --drift\` and paste the VERBATIM output. That tool measures
the tree fresh and reports where the ledger disagrees with it; it deliberately does not write. Rows
for THIS slice must show no drift. Pre-existing drift on other rows is NOT yours to clear — list it
in \`notCleared\` with why. If drift persists on a row you touched, fix the ROW, never the tool.`,
  { label: 'reconcile:ledger', phase: 'Reconcile', effort: 'high', schema: {
      type: 'object', additionalProperties: false,
      required: ['rowsUpdated', 'cursorAdvancedTo', 'driftOutput', 'notCleared', 'head', 'recorded'],
      properties: {
        rowsUpdated: { type: 'array', items: { type: 'string' } },
        cursorAdvancedTo: { type: ['string', 'null'], description: 'the new nextSeed, or null with the reason the cursor did not move' },
        driftOutput: { type: 'string', description: 'verbatim `node tools/launch/status.mjs --drift` output' },
        notCleared: { type: 'array', items: { type: 'string' }, description: 'rows still drifting and why they are not yours to clear' },
        head: { type: 'string', description: 'git rev-parse HEAD when you finished, verbatim.' },
        recorded: { type: 'array', items: { type: 'string' }, description: 'one line per snapshot you recorded: sha, subject, and the explicit paths staged. Empty array if the mode was off and you left the tree dirty.' },
      } } })

/* The script holds the only before-picture in the run, so it can say what moved and when. HEAD
 * moving BEFORE Reconcile is the defect — a lane wrote history, which races the index and empties
 * the git status the ownership audit reads. HEAD moving AT Reconcile is the intended outcome and
 * is reported as provenance. Compared at 7 chars: agents give short and long shas interchangeably. */
const moved = (h) => h && frame.head && h.slice(0, 7) !== frame.head.slice(0, 7)
const laneWroteHistory = moved(integrated?.head)
if (laneWroteHistory) log(`VIOLATION — a lane wrote history mid-run: HEAD ${frame.head} -> ${integrated.head} before Reconcile, so the ownership audit was reading a git status that no longer held those files.`)
if (COMMIT === 'reconcile') {
  log(`reconcile recorded: ${(reconciled?.recorded ?? []).length || 'NOTHING — the tree is left dirty, and .loop/run-once.sh:58 will decline the next scheduled run'}`)
} else if (moved(reconciled?.head)) {
  log(`mode is '${COMMIT}' but HEAD moved to ${reconciled.head} anyway`)
}

return {
  tree: { toplevel: frame.toplevel, branch: frame.branch, head: frame.head },
  laneWroteHistory,
  recorded: reconciled?.recorded ?? [],
  slice: frame.slice,
  milestoneJustification: frame.milestoneJustification,
  ownershipOverlap: collisions,
  built, integrated, fixes, verdict, reconciled,
}
