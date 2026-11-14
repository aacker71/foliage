import { parseJourneyMaintenance, changeJourneyMaintenance, maintainJourney, type JourneyMaintenance, type JourneyMaintainer, type JourneyOutcome } from './journeyMaintenance.ts';
import {
  mkdir,
  readFile,
  writeFile,
  rename,
  unlink,
  open,
  realpath,
} from "node:fs/promises";
import { join, isAbsolute } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash, randomUUID } from "node:crypto";
import { withDocumentLocks, writeDocument } from "@foliage/leaf/local-files";
import {
  mergeGitQueue,
  parseHarvestDocument,
  withoutUndecidedGitDrafts,
  type HarvestDocument,
  type QueueCommit,
  type JevMark,
} from "@foliage/photosynthesis";

import { checkoutHolds, mayHoldRepository, readQueueCommits, sameRepository, type QueueRead, type WorkflowCheckout } from "./gitQueueSource.ts";
import { gitAbsenceAsync, gitNeeded } from "./gitNeeded.ts";
import { decideJevPool } from "./jevPoolDecision.ts";
import {
  grantJevSource,
  jevCheckOrder,
  jevGrantedSources,
  jevQueueView,
  leafletJevMarks,
  parseJevWorkflow,
  prepareCandidateJev,
  revokeJevSource,
  revokeSourceGrants,
  type JevAccess,
  type JevIneligible,
  type JevWorkflowState,
} from "./jevWorkflow.ts";
const exec = promisify(execFile);
type Schedule = {
  cadence: "daily" | "weekly";
  day: string;
  time: string;
  timezone: string;
  quiet: boolean;
  start: string;
  end: string;
  paused: boolean;
};
type Source = {
  id: string;
  path: string;
  email: string;
  enabled: boolean;
  head?: string;
  lastRead?: string;
  error?: string;
};
type Evidence = { sha: string; title: string; email: string; observedAt?: string };
/**
 * A LEGACY packet. Collection no longer makes these: collected work goes to the one review queue,
 * harvest.json, decided at /review. Saved packets are still parsed and carried so nothing already
 * decided is lost, and the commits of accepted or dismissed ones are never drafted again.
 */
type Proposal = {
  id: string;
  source: string;
  title: string;
  evidence: Evidence[];
  omitted: number;
  status: "pending" | "accepted" | "dismissed" | "snoozed";
  until?: string;
  updatedAt: string;
  capturedAt?: string;
  collectedAt?: string;
  revision?: number;
};
export type CollectionRun = {
  id: string;
  startedAt: string;
  finishedAt?: string;
  trigger: "manual" | "scheduled" | "catch-up";
  sources: { id: string; status: "reading" | "collected" | "unchanged" | "failed"; from?: string; head?: string; packets: string[]; error?: string }[];
};
type State = {
  version: 1;
  jev?: JevWorkflowState;
  maintenance?: JourneyMaintenance;
  schedule: Schedule | null;
  sources: Source[];
  proposals: Proposal[];
  history: { at: string; status: string; detail: string; run?: CollectionRun }[];
  collection?: CollectionRun;
  nextAt: string | null;
  attempt: number;
  running: boolean;
};
/** Settings revision excludes collection activity, so an idle run does not stale the form. */
export function collectionSettingsRevision(state: Pick<State, 'schedule'|'sources'>): string {
  return createHash('sha256').update(JSON.stringify({schedule:state.schedule,sources:state.sources.map(s=>({id:s.id,enabled:s.enabled}))})).digest('hex');
}
const days = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const blank = (): State => ({
  version: 1,
  schedule: null,
  sources: [],
  proposals: [],
  history: [],
  nextAt: null,
  attempt: 0,
  running: false,
});
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
function scheduleValue(value: unknown): Schedule {
  const s = value as Schedule;
  if (
    !s ||
    !["daily", "weekly"].includes(s.cadence) ||
    !days.includes(s.day) ||
    ![s.time, s.start, s.end].every(
      (v) => typeof v === "string" && timePattern.test(v),
    ) ||
    typeof s.paused !== "boolean" ||
    typeof s.quiet !== "boolean" ||
    typeof s.timezone !== "string"
  )
    throw new Error("Invalid schedule settings.");
  try {
    new Intl.DateTimeFormat("en", { timeZone: s.timezone }).format();
  } catch {
    throw new Error("Invalid timezone.");
  }
  if (s.quiet && s.start === s.end)
    throw new Error("Quiet hours need different start and end times.");
  return {
    cadence: s.cadence,
    day: s.day,
    time: s.time,
    timezone: s.timezone,
    quiet: s.quiet,
    start: s.start,
    end: s.end,
    paused: s.paused,
  };
}
function local(date: Date, timezone: string) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      weekday: "long",
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  return {
    date: `${p["year"]}-${p["month"]}-${p["day"]}`,
    time: `${p["hour"]}:${p["minute"]}`,
    day: p["weekday"],
  };
}
function quiet(s: Schedule, time: string) {
  return (
    s.quiet &&
    (s.start < s.end
      ? time >= s.start && time < s.end
      : time >= s.start || time < s.end)
  );
}
function outsideQuiet(s: Schedule, at: Date) {
  let d = new Date(at);
  for (let i = 0; i < 1500 && quiet(s, local(d, s.timezone).time); i++)
    d = new Date(d.getTime() + 60_000);
  return d;
}
// Calendar days, not a 24-hour interval: DST folds never create a second daily run.
export function nextWorkflowRun(
  s: Schedule,
  after: Date,
  includeToday = false,
): string {
  const today = local(after, s.timezone).date;
  let d = new Date(Math.floor(after.getTime() / 60_000) * 60_000 + 60_000);
  for (let i = 0; i < 9 * 1440; i++, d = new Date(d.getTime() + 60_000)) {
    const p = local(d, s.timezone);
    if (
      (p.date !== today || (includeToday && p.time === s.time)) &&
      p.time >= s.time &&
      (s.cadence === "daily" || p["day"] === s.day)
    )
      return outsideQuiet(s, d).toISOString();
  }
  throw new Error("Could not resolve the next calendar window.");
}
async function git(path: string, ...args: string[]) {
  const { stdout } = await exec(
    "git",
    ["-c", "core.fsmonitor=false", "-C", path, ...args],
    {
      encoding: "utf8",
      timeout: 15000,
      maxBuffer: 4 * 1024 * 1024,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        GIT_OPTIONAL_LOCKS: "0",
      },
    },
  );
  return stdout.trim();
}
/**
 * A refusal whose way on needs one exact fact the sentence leaves out — a command that names the
 * folder. Sources keeps it under a closed Technical details rather than in the sentence.
 */
export class SourceRefusal extends Error {
  readonly technical: string;
  constructor(message: string, technical: string) { super(message); this.technical = technical; }
}
/**
 * Why git would not open a folder the person chose, in their terms. Only "not a repository" means
 * choosing another folder; a folder git refuses for its owner is fixed by marking it safe (git's
 * own remedy, kept as the technical detail), and a git that never ran or never answered is not
 * about the folder at all. A git that is missing, or that does not run (a Mac's /usr/bin/git
 * without the Command Line Tools), is asked before "not a repository" is said, and named in the
 * sentence `grow`, `watch` and `verify` say (`gitNeeded.ts`).
 */
async function gitOpenRefusal(error: unknown, path: string): Promise<Error> {
  const field = (key: string): unknown => error && typeof error === "object" && key in error ? (error as Record<string, unknown>)[key] : undefined;
  if (field("code") === "ENOENT") return new Error(gitNeeded("Foliage", "git is not installed here"));
  if (field("killed") === true) return new Error("Git didn't answer in time. Try again.");
  if (/dubious ownership/.test(String(field("stderr") ?? ""))) {
    return new SourceRefusal("Git doesn't trust this folder's owner. Mark it safe in Git, then try again.",
      `git config --global --add safe.directory '${path.replaceAll("'", "'\\''")}'`);
  }
  const absence = await gitAbsenceAsync();
  if (absence !== null) return new Error(gitNeeded("Foliage", absence));
  return new Error("Git can't open that folder as a repository. Choose the repository root directory.");
}
function validateRun(run: CollectionRun) {
  if (!run || typeof run.id !== "string" || !Number.isFinite(Date.parse(run.startedAt)) ||
      (run.finishedAt !== undefined && !Number.isFinite(Date.parse(run.finishedAt))) ||
      !["manual", "scheduled", "catch-up"].includes(run.trigger) || !Array.isArray(run.sources) ||
      run.sources.some(s => !s || typeof s.id !== "string" ||
        !["reading", "collected", "unchanged", "failed"].includes(s.status) ||
        !Array.isArray(s.packets) || s.packets.some(id => typeof id !== "string") ||
        (s.error !== undefined && typeof s.error !== "string") ||
        [s.from, s.head].some(ref => ref !== undefined && !/^[a-f0-9]{40,64}$/.test(ref))))
    throw new Error("Invalid collection trace.");
}
function validState(value: unknown): State {
  const s = value as State;
  if (
    !s ||
    s.version !== 1 ||
    !Array.isArray(s.sources) ||
    !Array.isArray(s.proposals) ||
    !Array.isArray(s.history) ||
    typeof s.running !== "boolean" ||
    !Number.isInteger(s.attempt) ||
    s.attempt < 0 ||
    !(
      s.nextAt === null ||
      (typeof s.nextAt === "string" && Number.isFinite(Date.parse(s.nextAt)))
    )
  )
    throw new Error("Workflow state malformed.");
  if (s.maintenance !== undefined) s.maintenance = parseJourneyMaintenance(s.maintenance);
  if (s.jev !== undefined) s.jev = parseJevWorkflow(s.jev);
  if (s.schedule !== null) scheduleValue(s.schedule);
  if (s.collection !== undefined) validateRun(s.collection);
  for (const h of s.history) if (h?.run !== undefined) validateRun(h.run);
  for (const v of s.sources)
    if (
      !v ||
      typeof v.id !== "string" ||
      typeof v.path !== "string" ||
      !isAbsolute(v.path) ||
      typeof v.email !== "string" ||
      typeof v.enabled !== "boolean" ||
      (v.head !== undefined && !/^[a-f0-9]{40,64}$/.test(v.head))
    )
      throw new Error("Invalid saved source.");
  for (const p of s.proposals)
    if (
      !p ||
      typeof p.id !== "string" ||
      typeof p.title !== "string" ||
      typeof p.source !== "string" ||
      !["pending", "accepted", "dismissed", "snoozed"].includes(p.status) ||
      !Array.isArray(p.evidence) ||
      p.evidence.some(
        (e) =>
          !e ||
          typeof e.title !== "string" ||
          typeof e.email !== "string" ||
          (e.observedAt !== undefined && !Number.isFinite(Date.parse(e.observedAt))) ||
          !/^[a-f0-9]{40,64}$/.test(e.sha),
      ) ||
      (p.revision !== undefined && (!Number.isSafeInteger(p.revision) || p.revision < 0)) ||
      (p.collectedAt !== undefined && !Number.isFinite(Date.parse(p.collectedAt))) ||
      !Number.isInteger(p.omitted) ||
      p.omitted < 0 ||
      (p.capturedAt !== undefined && (typeof p.capturedAt !== "string" || !Number.isFinite(Date.parse(p.capturedAt)))) ||
      (p.until !== undefined && !Number.isFinite(Date.parse(p.until)))
    )
      throw new Error("Invalid saved proposal.");
  for (const h of s.history)
    if (
      !h ||
      typeof h.detail !== "string" ||
      typeof h.status !== "string" ||
      !Number.isFinite(Date.parse(h.at))
    )
      throw new Error("Invalid collection history.");
  return s;
}
/** The commits an accepted or dismissed legacy packet holds: never drafted again. */
const legacyHeldShas = (proposals: readonly Proposal[]): ReadonlySet<string> =>
  new Set(proposals.filter((p) => p.status === "accepted" || p.status === "dismissed").flatMap((p) => p.evidence.map((e) => e.sha)));

/**
 * What another writer of the queue (`foliage grow`) must know from the collector's settings: the
 * checkouts it reads, and the commits legacy packet decisions hold. A missing file is no
 * collector; a malformed one is refused, never guessed around.
 */
export async function workflowQueueInputs(file: string): Promise<{ readonly checkouts: readonly WorkflowCheckout[]; readonly held: ReadonlySet<string> }> {
  let bytes: string;
  try {
    bytes = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { checkouts: [], held: new Set() };
    throw error;
  }
  const state = validState(JSON.parse(bytes));
  return {
    checkouts: state.sources.map(({ path, enabled }) => ({ path, enabled })),
    held: legacyHeldShas(state.proposals),
  };
}

/**
 * Read-only: the Jev marks stored in a workflow file for the named items. Never takes the owner
 * lock and never writes. A missing file gives no marks; an unreadable one is the caller's to report.
 */
export async function workflowJevMarks(file: string, ids: readonly string[]): Promise<ReadonlyMap<string, JevMark>> {
  let bytes: string;
  try {
    bytes = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Map();
    throw error;
  }
  return leafletJevMarks(validState(JSON.parse(bytes)).jev, ids);
}

/** Why one source gave the queue nothing. A label and the cause, never a guess. */
function readFailure(read: Extract<QueueRead, { readonly ok: false }>): string {
  switch (read.cause) {
    case "read-failed":
      return `${read.failure.cause} · ${read.failure.detail}`;
    case "attribution-refused":
      return `Attribution refused · ${read.issues.map((issue) => `${issue.at}: ${issue.message}`).join("; ")}`;
    default: {
      const impossible: never = read;
      throw new Error(`unhandled queue read: ${JSON.stringify(impossible)}`);
    }
  }
}

/** What a successful read could not do, as labels with their causes, or undefined when it did all of it. */
export function readShortfall(read: Extract<QueueRead, { readonly ok: true }>): string | undefined {
  const labels = [
    ...(read.narrowedBecause === null ? [] : [`History narrowed · ${read.narrowedBecause}`]),
    ...(read.datesUnreadBecause === null ? [] : [`Dates unread · ${read.datesUnreadBecause}`]),
  ];
  return labels.length === 0 ? undefined : labels.join("; ");
}

type HarvestRead =
  | { readonly kind: "absent" }
  | { readonly kind: "present"; readonly harvest: HarvestDocument; readonly bytes: string }
  | { readonly kind: "unreadable"; readonly detail: string };

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

async function readHarvest(path: string): Promise<HarvestRead> {
  let bytes: string;
  try {
    bytes = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { kind: "absent" };
    return { kind: "unreadable", detail: `Harvest unreadable · ${errorText(error)}` };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(bytes);
  } catch {
    return { kind: "unreadable", detail: "Harvest is not JSON" };
  }
  const parsed = parseHarvestDocument(raw);
  return parsed.ok
    ? { kind: "present", harvest: parsed.harvest, bytes }
    : { kind: "unreadable", detail: `Harvest invalid · ${parsed.issues.map((i) => `${i.at}: ${i.message}`).join("; ")}` };
}

const isLocalBusy = (error: unknown): boolean =>
  !!error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "ELOCALBUSY";

/** What one collection did to the queue. */
type QueueWrite =
  | { readonly kind: "written"; readonly drafted: readonly string[]; readonly withdrawn: readonly string[] }
  | { readonly kind: "unchanged" }
  /** Another writer holds the harvest: nothing happened, and the next pass tries again. */
  | { readonly kind: "busy" }
  /** Nothing could be queued from any source; the detail says why. */
  | { readonly kind: "refused"; readonly detail: string };

/** What one queue write means for the run: retry later, or these drafts, withdrawals and this refusal. */
function writeOutcome(
  write: QueueWrite,
):
  | { readonly kind: "busy" }
  | { readonly kind: "done"; readonly drafted: readonly string[]; readonly withdrawn: readonly string[]; readonly refused: string | undefined } {
  switch (write.kind) {
    case "busy":
      return { kind: "busy" };
    case "written":
      return { kind: "done", drafted: write.drafted, withdrawn: write.withdrawn, refused: undefined };
    case "unchanged":
      return { kind: "done", drafted: [], withdrawn: [], refused: undefined };
    case "refused":
      return { kind: "done", drafted: [], withdrawn: [], refused: write.detail };
    default: {
      const impossible: never = write;
      throw new Error(`unhandled queue write: ${JSON.stringify(impossible)}`);
    }
  }
}

interface SourceRead {
  readonly id: string;
  readonly path: string;
  readonly commits: readonly QueueCommit[];
  /** Every sha the walk read, this subject's or not: what is still in the repository. */
  readonly present: readonly string[];
  /** False when the walk narrowed: absence from it then proves nothing. */
  readonly complete: boolean;
  readonly repoRoot: string;
}

const NO_ERRORS: ReadonlyMap<string, string> = new Map();

/** Whether two paths name one checkout. A path that cannot be resolved names none. */
async function sameCheckout(a: string, b: string): Promise<boolean> {
  try {
    const [left, right] = await Promise.all([realpath(a), realpath(b)]);
    return left === right;
  } catch {
    return false;
  }
}

/** The repository the queue is bound to, read under the lock, or why nothing may be written. */
function queueRepository(
  read: HarvestRead,
  reads: readonly SourceRead[],
): { readonly kind: "bound"; readonly repo: string; readonly previous: Extract<HarvestRead, { readonly kind: "present" }> | undefined } | { readonly kind: "stop"; readonly write: QueueWrite } {
  switch (read.kind) {
    case "unreadable":
      return { kind: "stop", write: { kind: "refused", detail: read.detail } };
    case "present":
      return read.harvest.repo === undefined
        ? { kind: "stop", write: { kind: "refused", detail: "Queue not adopted · foliage migrate-queue" } }
        : { kind: "bound", repo: read.harvest.repo, previous: read };
    case "absent": {
      const repo = reads[0]?.repoRoot;
      return repo === undefined ? { kind: "stop", write: { kind: "unchanged" } } : { kind: "bound", repo, previous: undefined };
    }
    default: {
      const impossible: never = read;
      throw new Error(`unhandled harvest read: ${JSON.stringify(impossible)}`);
    }
  }
}

/**
 * THE COLLECTOR'S ONE WRITE. Every read checkout of the harvest's repository is merged into the
 * harvest through `mergeGitQueue` — the same merge `foliage grow` uses — so decided candidates are
 * frozen and new commits come back as their own drafts. A checkout of another repository is named
 * and left out. A harvest that records no repository has not been adopted and is never written.
 *
 * ONE DECISION POINT: the harvest is read, its repository checked against every checkout and the
 * merge written all under the harvest lock, so no answer rests on a read another writer has since
 * replaced. The git reads themselves happen before, outside the lock.
 */
async function collectIntoQueue(input: {
  readonly harvestPath: string | undefined;
  readonly reads: readonly SourceRead[];
  /**
   * Checkouts this pass did not read: paused, or their read failed. Only one that may hold the
   * queue's repository (the same one, or one that cannot be checked) leaves absence unproven.
   */
  readonly unread: readonly string[];
  readonly heldExtra: ReadonlySet<string>;
  readonly observedAt: string;
}): Promise<{ readonly write: QueueWrite; readonly errors: ReadonlyMap<string, string> }> {
  if (input.harvestPath === undefined) return { write: { kind: "refused", detail: "No harvest configured" }, errors: NO_ERRORS };
  const harvestPath = input.harvestPath;
  try {
    return await withDocumentLocks([harvestPath], async () => {
      const fresh = await readHarvest(harvestPath);
      const bound = queueRepository(fresh, input.reads);
      if (bound.kind === "stop") return { write: bound.write, errors: NO_ERRORS };
      const { repo, previous } = bound;
      const matches = await Promise.all(input.reads.map(async (read) => [read, await sameRepository(read.path, repo)] as const));
      const errors = new Map(
        matches.flatMap(([read, match]): (readonly [string, string])[] => {
          switch (match.kind) {
            case "same":
              return [];
            case "different":
              return [[read.id, `Different repository · ${repo}`]];
            case "unreadable":
              return [[read.id, `Repository check failed · ${match.detail}`]];
            default: {
              const impossible: never = match;
              throw new Error(`unhandled repository match: ${JSON.stringify(impossible)}`);
            }
          }
        }),
      );
      const matched = input.reads.filter((read) => !errors.has(read.id));
      if (matched.length === 0) return { write: { kind: "unchanged" }, errors };
      // A checkout whose repository could not be confirmed, a narrowed walk, and an unread checkout
      // that may hold this repository each leave the drafts only they hold not proven gone. A
      // paused or broken checkout of ANOTHER repository proves nothing about this one either way.
      const confirmed = matches.every(([, match]) => match.kind !== "unreadable");
      const unreadMayHold = await Promise.all(input.unread.map((path) => mayHoldRepository(path, repo)));
      // The checkout the queue is bound to is the one `foliage grow` reads. What it holds is still
      // in the repository even when no source here is that checkout, exactly as grow keeps what
      // these checkouts hold.
      const growsFrom = (await Promise.all(matched.map((read) => sameCheckout(read.path, repo)))).includes(true)
        ? { present: [], complete: true }
        : await checkoutHolds(repo);
      const complete = confirmed && growsFrom.complete && matched.every((read) => read.complete) && !unreadMayHold.includes(true);
      const merged = mergeGitQueue({
        previous: previous?.harvest,
        commits: matched.flatMap((read) => read.commits),
        present: new Set([...matched.flatMap((read) => read.present), ...growsFrom.present]),
        heldExtra: input.heldExtra,
        observedAt: input.observedAt,
        complete,
      });
      const document = previous === undefined ? { repo, candidates: merged.document.candidates } : merged.document;
      const text = `${JSON.stringify(document, null, 2)}\n`;
      const check = parseHarvestDocument(JSON.parse(text));
      if (!check.ok) return { write: { kind: "refused", detail: `Queue invalid · ${check.issues.map((i) => `${i.at}: ${i.message}`).join("; ")}` }, errors };
      if (previous !== undefined && text === previous.bytes) return { write: { kind: "unchanged" }, errors };
      writeDocument(harvestPath, text);
      return { write: { kind: "written", drafted: merged.drafted, withdrawn: merged.withdrawn }, errors };
    });
  } catch (error) {
    if (isLocalBusy(error)) return { write: { kind: "busy" }, errors: NO_ERRORS };
    return { write: { kind: "refused", detail: `Queue write failed · ${errorText(error)}` }, errors: NO_ERRORS };
  }
}

/**
 * Removing the last checkout of the harvest's repository withdraws its UNDECIDED git drafts —
 * derived data `foliage grow` recomputes. Decided work is never touched. A remaining checkout
 * that cannot be checked may still be one of the repository, so it keeps them too.
 */
async function clearQueueAfterRemoval(harvestPath: string | undefined, removed: Source, remaining: readonly Source[]): Promise<void> {
  if (harvestPath === undefined) return;
  const first = await readHarvest(harvestPath);
  if (first.kind !== "present" || first.harvest.repo === undefined) return;
  const repo = first.harvest.repo;
  if ((await sameRepository(removed.path, repo)).kind !== "same") return;
  for (const source of remaining) if (await mayHoldRepository(source.path, repo)) return;
  try {
    await withDocumentLocks([harvestPath], async () => {
      const fresh = await readHarvest(harvestPath);
      if (fresh.kind !== "present") return;
      const cleared = withoutUndecidedGitDrafts(fresh.harvest);
      if (cleared.candidates.length === fresh.harvest.candidates.length) return;
      writeDocument(harvestPath, `${JSON.stringify(cleared, null, 2)}\n`);
    });
  } catch (error) {
    throw new Error(isLocalBusy(error) ? "Queue busy. Try again." : `Queue write failed · ${errorText(error)}`);
  }
}

/** Why a draft is not sent to Jev, as a label. */
function ineligibleLabel(cause: JevIneligible): string {
  switch (cause) {
    case "missing":
      return "Draft not found.";
    case "decided":
      return "Already decided.";
    case "not-git":
      return "Not a git draft.";
    case "untitled":
      return "No commit titles.";
    case "too-large":
      return "Too large for Jev.";
    case "unsendable":
      return "Jev cannot take this draft.";
    case "no-grant":
      return "Allow this source to send commit titles to TypeSafe before using Jev.";
    default: {
      const impossible: never = cause;
      throw new Error(`unhandled Jev cause: ${JSON.stringify(impossible)}`);
    }
  }
}

export async function openWorkflow(
  directory: string,
  options: {
    readonly env?: Readonly<Record<string, string | undefined>>;
    readonly fetcher?: typeof fetch;
    readonly journey?: JourneyMaintainer;
    /** The one review queue collection writes into. Without it, collection records why. */
    readonly harvestPath?: string;
  } = {},
) {
  const jev = { env: options.env ?? process.env, fetcher: options.fetcher, journey: options.journey };
  const harvestPath = options.harvestPath;
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const lock = join(directory, "owner.lock");
  // The process lock protects the whole state transaction, including collection/checkpoint writes.
  try {
    const f = await open(lock, "wx", 0o600);
    await f.writeFile(String(process.pid));
    await f.close();
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    const pid = Number(await readFile(lock, "utf8"));
    if (!Number.isSafeInteger(pid) || pid <= 0)
      throw new Error(
        "Workflow lock unreadable.",
      );
    try {
      process.kill(pid, 0);
      throw new Error(
        "Workflow open in another process.",
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
    await unlink(lock);
    const f = await open(lock, "wx", 0o600);
    await f.writeFile(String(process.pid));
    await f.close();
  }
  const file = join(directory, "workflow.json");
  let state = blank();
  let closed = false;
  let queue: Promise<unknown> = Promise.resolve();
  let scheduleEpoch = 0;
  let journeyRequestInFlight = false;
  async function save() {
    const temp = file + "." + randomUUID() + ".tmp";
    await writeFile(temp, JSON.stringify(state, null, 2) + "\n", {
      mode: 0o600,
    });
    await rename(temp, file);
  }
  function history(status: string, detail: string, now: Date, run?: CollectionRun) {
    state.history.unshift({ at: now.toISOString(), status, detail, ...(run ? { run: structuredClone(run) } : {}) });
    state.history = state.history.slice(0, 48);
  }
  function serial<T>(fn: () => Promise<T>): Promise<T> {
    const result = queue.then(fn);
    queue = result.catch(() => {});
    return result;
  }
  /** Only an interrupted pending receipt may be committed after the schedule stops.
   * A late provider result can never be promoted to a suggestion by this exception. */
  function interruptedOnly(expected: JourneyMaintenance, next: JourneyMaintenance): boolean {
    if (JSON.stringify(expected.grants) !== JSON.stringify(next.grants) || expected.attempts.length !== next.attempts.length) return false;
    let changed = 0;
    for (let i = 0; i < expected.attempts.length; i++) {
      const before = expected.attempts[i]!, after = next.attempts[i]!;
      if (JSON.stringify(before) === JSON.stringify(after)) continue;
      if (before.status !== 'pending' || JSON.stringify(after) !== JSON.stringify({...before,status:'interrupted',detail:'session_paused'})) return false;
      changed++;
    }
    return changed === 1;
  }
  /** Provider calls run outside serial. This gate takes only a brief persistence turn;
   * grant revocation, pause and owner edits can proceed while inference is in flight. */
  async function requestJourneySuggestion(grantId?: string): Promise<JourneyOutcome> {
    if (journeyRequestInFlight) return {kind:'busy'};
    const maintainer = jev.journey;
    if (closed) return {kind:'gated',reason:'workflow_closed'};
    if (!state.maintenance) return {kind:'gated',reason:'permission_missing'};
    if (!maintainer) return {kind:'disconnected'};
    if (grantId !== undefined && (!grantId || !state.maintenance.grants.some(grant => grant.id === grantId && !grant.revokedAt))) return {kind:'revoked'};
    const requestedScheduleEpoch = scheduleEpoch;
    const gateReason = (): JourneyOutcome['reason'] => {
      const schedule = state.schedule;
      if (closed) return 'workflow_closed';
      if (scheduleEpoch !== requestedScheduleEpoch) return 'schedule_changed';
      if (!schedule) return 'schedule_missing';
      if (schedule.paused) return 'schedule_paused';
      if (quiet(schedule, local(new Date(), schedule.timezone).time)) return 'quiet_hours';
      return undefined;
    };
    const eligible = () => gateReason() === undefined;
    const gate = {
      eligible,
      current: () => {
        if (!state.maintenance) throw new Error('Journey maintenance unavailable.');
        return structuredClone(state.maintenance);
      },
      commit: (expected: JourneyMaintenance, next: JourneyMaintenance) => serial(async () => {
        if (closed || !state.maintenance || JSON.stringify(state.maintenance) !== JSON.stringify(expected)) return false;
        if (!eligible() && !interruptedOnly(expected, next)) return false;
        const before = state.maintenance;
        state.maintenance = parseJourneyMaintenance(next);
        try { await save(); } catch (error) { state.maintenance = before; throw error; }
        return true;
      }),
    };
    journeyRequestInFlight = true;
    try {
      const outcome = await maintainJourney(state.maintenance, jev.env, {
        ready: () => !closed && maintainer.ready(),
        collaborate: context => maintainer.collaborate(context),
      }, save, jev.fetcher, gate, grantId);
      return outcome.kind === 'gated' ? {...outcome,reason:gateReason()??'schedule_changed'} : outcome;
    } finally { journeyRequestInFlight = false; }
  }
  try {
    try {
      state = validState(JSON.parse(await readFile(file, "utf8")));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    if(state.maintenance?.attempts.some(a=>a.status==='pending')) {
      state.maintenance.attempts=state.maintenance.attempts.map(a=>a.status==='pending'?{...a,status:'interrupted',detail:'Application stopped during an update. Inspect journey history before re-enabling.'}:a);await save();
    }
    if (state.jev?.attempts.some(a=>a.status==='pending')) {
      state.jev.attempts=state.jev.attempts.map(a=>a.status==='pending'?{...a,status:'interrupted'}:a);
      await save();
    }
    if (state.running) {
      state.running = false;
      history(
        "interrupted",
        "Interrupted. Will retry.",
        new Date(),
        state.collection,
      );
      await save();
    }
  } catch (e) {
    await unlink(lock);
    throw e;
  }
  /**
   * The Jev pass now running, if any. SINGLE-FLIGHT: the timer and the manual collect both tick,
   * and a tick that arrives while a pass runs joins it. Two passes never overlap, so no pass acts
   * on a queue order another pass has already sent from.
   */
  let checking: Promise<void> | undefined;
  function checkOnce(now: Date): Promise<void> {
    checking ??= checkQueue(now).finally(() => {
      checking = undefined;
    });
    return checking;
  }
  async function tick(now = new Date(), manual = false) {
    await collect(now, manual);
    if (!closed) await checkOnce(now);
  }
  async function collect(now: Date, manual: boolean) {
    return serial(async () => {
      if (
        closed ||
        !state.schedule ||
        state.schedule.paused ||
        !state.sources.some((s) => s.enabled)
      ) {
        if (manual)
          throw new Error(
            "Enable a source and resume the schedule first.",
          );
        return;
      }
      const s = state.schedule;
      // Quiet hours hold the schedule's own passes. The owner's Collect now is a local read they
      // asked for, so it runs; the Jev pass after it still waits for quiet hours to end.
      if (!manual && quiet(s, local(now, s.timezone).time)) return;
      if (
        !manual &&
        (!state.nextAt || Date.parse(state.nextAt) > now.getTime())
      )
        return;
      const before = structuredClone(state);
      state.running = true;
      state.collection = { id: randomUUID(), startedAt: now.toISOString(),
        trigger: manual ? "manual" : state.nextAt && now.getTime() - Date.parse(state.nextAt) > 60_000 ? "catch-up" : "scheduled", sources: [] };
      try { await save(); } catch (error) { state = before; throw error; }
      let failures = 0;
      let changed = 0;
      const unread: string[] = state.sources.filter((source) => !source.enabled).map((source) => source.path);
      const fail = (source: Source, trace: CollectionRun["sources"][number], error: unknown) => {
        source.error = errorText(error).slice(0, 2000);
        trace.status = "failed";
        trace.error = source.error;
        failures++;
      };
      try {
        const reads: { readonly source: Source; readonly trace: CollectionRun["sources"][number]; readonly read: Extract<QueueRead, { readonly ok: true }> }[] = [];
        // GIT FIRST, as connecting a source asks it (`gitOpenRefusal`): a git that is missing, or a
        // Mac's /usr/bin/git without the Command Line Tools, reads no source, and its failure is not
        // "not a git work tree". Asked once a pass; each source records the one sentence instead.
        const absence = await gitAbsenceAsync();
        for (const source of state.sources.filter((s) => s.enabled)) {
          const trace: CollectionRun["sources"][number] = { id: source.id, status: "reading", packets: [], ...(source.head ? { from: source.head } : {}) };
          state.collection.sources.push(trace);
          try {
            if (absence !== null) throw new Error(gitNeeded("Foliage", absence));
            const read = await readQueueCommits(source.path, [source.email]);
            if (!read.ok) throw new Error(readFailure(read));
            if (read.head !== null) trace.head = read.head;
            reads.push({ source, trace, read });
          } catch (e) {
            fail(source, trace, e);
            unread.push(source.path);
          }
        }
        const queue = await collectIntoQueue({
          harvestPath,
          reads: reads.map(({ source, read }) => ({
            id: source.id,
            path: source.path,
            commits: read.commits,
            present: [...read.commits, ...read.theirs].map((c) => c.sha),
            complete: read.complete,
            repoRoot: read.repoRoot,
          })),
          unread,
          heldExtra: legacyHeldShas(state.proposals),
          observedAt: now.toISOString(),
        });
        const outcome = writeOutcome(queue.write);
        if (outcome.kind === "busy") {
          // Another writer holds the queue (a decision at /review, a grow). Not a failure: this
          // run leaves no trace and the next pass tries again.
          state = before;
          if (manual) throw new Error("Queue busy. Try again.");
          return false;
        }
        const { drafted, withdrawn, refused } = outcome;
        for (const { source, trace, read } of reads) {
          const error = queue.errors.get(source.id) ?? refused;
          if (error !== undefined) {
            fail(source, trace, new Error(error));
            continue;
          }
          if (read.head !== null) source.head = read.head;
          source.lastRead = now.toISOString();
          trace.status = drafted.length || withdrawn.length ? "collected" : "unchanged";
          trace.packets = [...drafted];
          // A read that narrowed or left dates unread still collected, and says why by name.
          const partial = readShortfall(read);
          if (partial === undefined) delete source.error;
          else source.error = trace.error = partial.slice(0, 2000);
        }
        changed = drafted.length;
        state.attempt = failures ? state.attempt + 1 : 0;
        state.nextAt =
          failures && state.attempt < 3
            ? outsideQuiet(
                s,
                new Date(now.getTime() + 5 * 60_000 * state.attempt),
              ).toISOString()
            : nextWorkflowRun(s, now);
        if (state.attempt >= 3) state.attempt = 0;
        state.collection.finishedAt = new Date().toISOString();
        history(
          failures ? "failed" : changed ? "review-ready" : withdrawn.length ? "withdrawn" : "unchanged",
          `${changed} drafted · ${withdrawn.length} withdrawn · ${failures} failed`,
          now,
          state.collection,
        );
      } finally {
        state.running = false;
        try {
          await save();
        } catch (error) {
          state = before;
          throw error;
        }
      }
      return true;
    });
  }
  /**
   * Which grant Jev acts under for this queue: the first enabled, granted checkout of its
   * repository. FAILS CLOSED: a checkout that cannot be checked (moved, gone, broken) is not
   * proven to be this repository, so its grant sends nothing.
   */
  async function jevAccess(harvest: HarvestDocument, current: WorkflowSnapshot): Promise<JevAccess | undefined> {
    const repo = harvest.repo;
    if (repo === undefined) return undefined;
    for (const source of jevGrantedSources(current)) {
      const match = await sameRepository(source.path, repo);
      switch (match.kind) {
        case "same":
          return { grant: source.grant, source: source.source, email: source.email };
        case "different":
        case "unreadable":
          continue;
        default: {
          const impossible: never = match;
          throw new Error(`unhandled repository match: ${JSON.stringify(impossible)}`);
        }
      }
    }
    return undefined;
  }
  /** Add one history line unless the newest line already says exactly this. */
  function historyOnce(status: string, detail: string, now: Date): boolean {
    const last = state.history[0];
    if (last !== undefined && last.run === undefined && last.status === status && last.detail === detail) return false;
    history(status, detail, now);
    return true;
  }
  /**
   * JEV CHECKS THE QUEUE. Every timer pass while the schedule runs outside quiet hours, the open
   * drafts nobody has checked go to Jev newest work first, at most three new decisions per pass.
   * A draft Jev may not see costs nothing and leaves no line. The first provider failure stops
   * the pass with one history line, and the same failure again adds none. A pause or quiet hours
   * that begin mid-pass stop it before the next send, with no line. A check the provider
   * did not answer, and an interrupted one, are never sent again here: only the owner retries
   * them. Nothing here writes the harvest: a mark only places a row at /review.
   */
  async function checkQueue(now: Date) {
    const s = state.schedule;
    if (closed || harvestPath === undefined || !s || s.paused || quiet(s, local(now, s.timezone).time)) return;
    // Capture never needs the cloud, and an unconfigured client would only record failures.
    if (!jev.env["TYPESAFE_API_KEY"]?.trim()) return;
    const read = await readHarvest(harvestPath);
    if (read.kind !== "present") return;
    const current = snapshot();
    const access = await jevAccess(read.harvest, current);
    if (access === undefined) return;
    let failure: string | undefined;
    for (const id of jevCheckOrder(current.jev, read.harvest, access).slice(0, 3)) {
      try {
        const decided = await decide(id, false, true);
        switch (decided.kind) {
          case "ineligible":
            continue;
          case "stopped":
            // The owner paused the schedule, or quiet hours began, while this pass ran: a stop, not a failure.
            return;
          case "decided": {
            const receipt = decided.attempt.receipt;
            if (receipt?.reason === "provider_unavailable") failure = receipt.detail ?? "Jev unavailable";
            break;
          }
          default: {
            const impossible: never = decided;
            throw new Error(`unhandled Jev decision: ${JSON.stringify(impossible)}`);
          }
        }
      } catch (error) {
        failure = errorText(error);
      }
      if (failure !== undefined || closed) break;
    }
    if (failure === undefined || closed) return;
    const detail = failure;
    await serial(async () => {
      if (closed) return;
      const before = structuredClone(state);
      if (!historyOnce("jev-unavailable", detail, new Date())) return;
      try { await save(); } catch { state = before; throw new Error("Jev failed. Capture saved."); }
    });
  }
  /** One Jev decision for one open draft, or why it may not be sent. Never writes the harvest. */
  async function decide(id: string, retry: boolean, automatic: boolean): Promise<
    | { readonly kind: "ineligible"; readonly cause: JevIneligible }
    | { readonly kind: "stopped" }
    | { readonly kind: "decided"; readonly attempt: JevWorkflowState["attempts"][number] }
  > {
    return serial(async()=>{
      if(closed) throw new Error('Workflow is closed.');
      if(automatic && (!state.schedule || state.schedule.paused || quiet(state.schedule,local(new Date(),state.schedule.timezone).time))) return {kind:'stopped'} as const;
      if(harvestPath===undefined) throw new Error('No harvest configured');
      const read=await readHarvest(harvestPath);
      if(read.kind==='unreadable') throw new Error(read.detail);
      if(read.kind==='absent') return {kind:'ineligible',cause:'missing'} as const;
      const prepared=prepareCandidateJev(read.harvest,id,await jevAccess(read.harvest,snapshot()));
      if(!prepared.ok) return {kind:'ineligible',cause:prepared.cause} as const;
      const current=state.jev!;
      const existing=current.attempts.findLast(a=>a.packet===id&&a.grant===prepared.grant&&a.selectionDigest===prepared.selectionDigest);
      // Any outcome of this exact selection stands unless the owner retries it; a keep or pass
      // stands even then. Every attempt is kept: the history is never pruned.
      if(existing && (!retry || existing.receipt?.outcome==='keep' || existing.receipt?.outcome==='pass')) return {kind:'decided',attempt:structuredClone(existing)} as const;
      if(current.attempts.length>=1024) throw new Error('Jev history full.');
      const before=structuredClone(state);
      const attempt: JevWorkflowState['attempts'][number]={id:randomUUID(),grant:prepared.grant,packet:id,selectionDigest:prepared.selectionDigest,startedAt:new Date().toISOString(),status:'pending'};
      state.jev={...current,attempts:[...current.attempts,attempt]};
      try { await save(); } catch(error) {state=before;throw error;}
      // This serialized operation is bounded by the shared transport timeout. Revocation takes
      // effect when its command commits; it cannot recall a request already sent to TypeSafe.
      try {
        const receipt=await decideJevPool(prepared.selection,{provider:'typesafe',selectionDigest:prepared.selectionDigest},jev.env,jev.fetcher);
        attempt.receipt={...receipt,caller:'photosynthesis',evidenceRefs:[...receipt.evidenceRefs]};attempt.status='completed';
        await save();
        return {kind:'decided',attempt:structuredClone(attempt)} as const;
      } catch(error) {
        delete attempt.receipt;attempt.status='interrupted';
        try {await save();} catch {throw new Error('Jev save failed. Check the pending attempt.');}
        throw error;
      }
    });
  }
  /** The owner's own check of one draft, from /review. Refuses by name what may not be sent. */
  async function decideCandidate(id: string) {
    const decided = await decide(id, true, false);
    switch (decided.kind) {
      case "ineligible":
        throw new Error(ineligibleLabel(decided.cause));
      case "stopped":
        // Only a scheduled pass stops for the schedule; the owner's own check never does.
        throw new Error("Schedule paused.");
      case "decided":
        return decided.attempt;
      default: {
        const impossible: never = decided;
        throw new Error(`unhandled Jev decision: ${JSON.stringify(impossible)}`);
      }
    }
  }
  /** /review's view of Jev for this harvest: current marks, and the drafts the owner may retry. */
  async function jevView(harvest: HarvestDocument) {
    const current = snapshot();
    return jevQueueView(current.jev, harvest, await jevAccess(harvest, current));
  }
  async function command(input: unknown) {
    return serial(async () => {
      const c = input as {
        action?: unknown;
        schedule?: unknown;
        path?: unknown;
        email?: unknown;
        authorized?: unknown;
        id?: unknown;
        revision?: unknown;
        sources?: unknown;
      };
      if (!c || typeof c.action !== "string")
        throw new Error("Choose an action.");
      if (closed) throw new Error("Workflow is closed.");
      const before = structuredClone(state);
      const now = new Date();
      try {
        if(c.action==='journey-grant'||c.action==='journey-revoke') {
          if(c.action==='journey-grant'&&!jev.journey?.ready()) throw new Error('Connect Scarlet before enabling journey updates.');
          state.maintenance=await changeJourneyMaintenance(state.maintenance,input,jev.env);
        }
        else if(c.action==='jev-grant') state.jev=grantJevSource(snapshot(),input,now);
        else if(c.action==='jev-revoke') state.jev=revokeJevSource(snapshot(),input,now);
        else if (c.action === 'collection-settings') {
          if(c.revision!==collectionSettingsRevision(state)) throw new Error('Settings changed. Reload.');
          const selected=c.sources;
          if(!Array.isArray(selected)||selected.some(id=>typeof id!=='string'||!state.sources.some(s=>s.id===id))||new Set(selected).size!==selected.length) throw new Error('Choose current connected sources.');
          const schedule=scheduleValue(c.schedule);
          if(!schedule.paused&&!selected.length) throw new Error('Select a source first.');
          state.sources=state.sources.map(s=>({...s,enabled:selected.includes(s.id)}));
          state.schedule=schedule;
          scheduleEpoch++;
          state.nextAt=nextWorkflowRun(schedule,now,true);
          state.attempt=0;
        } else if (c.action === "schedule") {
          state.schedule = scheduleValue(c.schedule);
          scheduleEpoch++;
          state.nextAt =
            before.schedule?.paused && !state.schedule.paused
              ? outsideQuiet(state.schedule, now).toISOString()
              : nextWorkflowRun(state.schedule, now, true);
          state.attempt = 0;
        } else if (c.action === "source") {
          if (
            typeof c.path !== "string" ||
            !isAbsolute(c.path) ||
            typeof c.email !== "string" ||
            !/^\S+@\S+\.\S+$/.test(c.email.trim()) ||
            c.authorized !== true
          )
            throw new Error(
              "Absolute path, email and authorization required.",
            );
          // The person typed this path, so a miss is named in their terms and the next step,
          // never as the OS or git error (an ENOENT with the path echoed back, or git's stderr).
          const path = await realpath(c.path).catch(() => {
            throw new Error("No folder at that path. Check it and try again.");
          });
          const top = await git(path, "rev-parse", "--show-toplevel").catch(async (error: unknown) => {
            throw await gitOpenRefusal(error, path);
          });
          if (top !== path)
            throw new Error("Choose the repository root directory.");
          const email = c.email.trim().toLowerCase();
          if (state.sources.some((s) => s.path === path && s.email === email))
            throw new Error(
              "Already connected.",
            );
          if (state.sources.length >= 10)
            throw new Error("Limit is ten sources.");
          const id = createHash("sha256")
            .update(path + "\0" + email)
            .digest("hex");
          state.sources.push({ id, path, email, enabled: true });
        } else if (
          c.action === "source-toggle" ||
          c.action === "source-remove"
        ) {
          const source = state.sources.find((s) => s.id === c.id);
          if (!source) throw new Error("Source no longer exists.");
          if (c.action === "source-toggle") source.enabled = !source.enabled;
          else {
            state.sources = state.sources.filter((s) => s !== source);
            if(state.jev) state.jev=revokeSourceGrants(state.jev,source.id,now);
            await clearQueueAfterRemoval(harvestPath, source, state.sources);
          }
        } else throw new Error("Unknown workflow action.");
        await save();
        return snapshot();
      } catch (e) {
        state = before;
        throw e;
      }
    });
  }
  function snapshot(): WorkflowSnapshot {
    return structuredClone({ ...state, active: !closed });
  }
  /** A short owner save may hold the workflow queue; provider inference never does. */
  function finalizeJourneySuggestion<T>(attemptId: string, expectedRevision: string, apply: (current: JourneyMaintenance) => Promise<{after: string; value: T}>): Promise<T> {
    return serial(async () => {
      if (closed) throw new Error('Workflow is closed. Reopen Scarlet.');
      if (!jev.journey?.ready()) throw new Error('Connect Scarlet before saving this update.');
      const schedule=state.schedule;
      if (!schedule || schedule.paused || quiet(schedule,local(new Date(),schedule.timezone).time)) throw new Error('Collection is paused. Resume it before saving this update.');
      const before=state.maintenance;
      const attempt=before?.attempts.find(row=>row.id===attemptId&&row.status==='suggested'&&row.draft?.revision===expectedRevision);
      const grant=before?.grants.find(row=>row.id===attempt?.grant&&!row.revokedAt);
      if (!before||!attempt?.draft||!grant) throw new Error('This update is no longer available.');
      const result=await apply(structuredClone(before));
      const {draft:_draft,...completed}=attempt;
      state.maintenance=parseJourneyMaintenance({...before,attempts:before.attempts.map(row=>row.id===attemptId?{...completed,status:'applied' as const,after:result.after}:row)});
      try {await save();} catch {state.maintenance=before;throw new Error('Journey saved, but its receipt is unavailable. Inspect History before retrying.');}
      return result.value;
    });
  }
  function discardJourneySuggestion(attemptId: string, expectedRevision: string): Promise<void> {
    return serial(async () => {
      if (closed) throw new Error('Workflow is closed. Reopen Scarlet.');
      const before=state.maintenance;
      const attempt=before?.attempts.find(row=>row.id===attemptId&&row.status==='suggested'&&row.draft?.revision===expectedRevision);
      if (!before||!attempt?.draft) throw new Error('This update is no longer available.');
      const {draft:_draft,...discarded}=attempt;
      state.maintenance=parseJourneyMaintenance({...before,attempts:before.attempts.map(row=>row.id===attemptId?{...discarded,status:'discarded' as const,detail:'owner_discarded'}:row)});
      try {await save();} catch(error) {state.maintenance=before;throw error;}
    });
  }
  return {
    snapshot,
    withSnapshot: <T>(work: (state: WorkflowSnapshot) => Promise<T>): Promise<T> => serial(() => work(snapshot())),
    command,
    /** Legacy entrypoint is intentionally inert; only the explicit owner request transfers. */
    maintainJourneys: async () => ({kind:'gated' as const}),
    requestJourneySuggestion,
    finalizeJourneySuggestion,
    discardJourneySuggestion,
    decideCandidate,
    jevView,
    tick,
    close: async () => {
      closed = true;
      await queue;
      await unlink(lock);
    },
  };
}

export type WorkflowSnapshot = State & { active: boolean };
