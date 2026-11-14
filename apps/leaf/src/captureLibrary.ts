/** Private, receipt-checked reads of owner-invoked local web captures. */
import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

// mkdtemp appends six unpredictable alphanumeric characters to `capture-`.
const CAPTURE_ID = /^capture-[A-Za-z0-9_-]{6,64}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const MAX_ARTIFACT_BYTES = 64 * 1024 * 1024;
const PNG_MAGIC = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

interface CapturedArtifact {
  readonly file: "screenshot.png" | "demo.mp4";
  readonly mimeType: "image/png" | "video/mp4";
  readonly bytes: number;
  readonly sha256: string;
}

export interface CaptureReceipt {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly source: { readonly requestedUrl: string; readonly finalUrl: string; readonly origin: string; readonly pageTitle?: string | null };
  readonly capture: { readonly startedAt: string; readonly screenshotAt?: string; readonly completedAt: string; readonly requestedDurationSeconds: number; readonly width?: number; readonly height?: number; readonly frameRate?: number; readonly frameCount?: number };
  readonly artifacts: { readonly screenshot: CapturedArtifact; readonly video: CapturedArtifact };
  readonly privacy: { readonly localOnly: true };
}

export function captureRootFor(leafPath: string): string {
  return join(dirname(resolve(leafPath)), "captures");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validArtifact(value: unknown, file: CapturedArtifact["file"], mimeType: CapturedArtifact["mimeType"]): value is CapturedArtifact {
  return isObject(value) && value["file"] === file && value["mimeType"] === mimeType &&
    typeof value["bytes"] === "number" && Number.isSafeInteger(value["bytes"]) && value["bytes"] > 0 && value["bytes"] <= MAX_ARTIFACT_BYTES &&
    typeof value["sha256"] === "string" && DIGEST.test(value["sha256"]);
}

function parseReceipt(value: unknown, id: string): CaptureReceipt | null {
  if (!isObject(value) || value["schemaVersion"] !== 1 || value["id"] !== id || !isObject(value["source"]) || !isObject(value["capture"]) || !isObject(value["artifacts"]) || !isObject(value["privacy"])) return null;
  const source = value["source"], capture = value["capture"], artifacts = value["artifacts"], privacy = value["privacy"];
  if (privacy["localOnly"] !== true || typeof source["requestedUrl"] !== "string" || typeof source["finalUrl"] !== "string" || typeof source["origin"] !== "string" ||
    !(source["pageTitle"] === undefined || source["pageTitle"] === null || typeof source["pageTitle"] === "string" && source["pageTitle"].length <= 160) ||
    typeof capture["startedAt"] !== "string" || Number.isNaN(Date.parse(capture["startedAt"])) ||
    (capture["screenshotAt"] !== undefined && (typeof capture["screenshotAt"] !== "string" || Number.isNaN(Date.parse(capture["screenshotAt"])))) ||
    typeof capture["completedAt"] !== "string" || Number.isNaN(Date.parse(capture["completedAt"])) ||
    typeof capture["requestedDurationSeconds"] !== "number" || !Number.isFinite(capture["requestedDurationSeconds"]) || capture["requestedDurationSeconds"] < 1 || capture["requestedDurationSeconds"] > 30 ||
    (capture["width"] !== undefined && (typeof capture["width"] !== "number" || !Number.isInteger(capture["width"]) || capture["width"] < 320 || capture["width"] > 1920)) ||
    (capture["height"] !== undefined && (typeof capture["height"] !== "number" || !Number.isInteger(capture["height"]) || capture["height"] < 240 || capture["height"] > 1080)) ||
    (capture["frameRate"] !== undefined && (typeof capture["frameRate"] !== "number" || !Number.isInteger(capture["frameRate"]) || capture["frameRate"] < 1 || capture["frameRate"] > 60)) ||
    (capture["frameCount"] !== undefined && (typeof capture["frameCount"] !== "number" || !Number.isInteger(capture["frameCount"]) || capture["frameCount"] < 1 || capture["frameCount"] > 900)) ||
    ((capture["frameRate"] === undefined) !== (capture["frameCount"] === undefined)) ||
    !validArtifact(artifacts["screenshot"], "screenshot.png", "image/png") || !validArtifact(artifacts["video"], "demo.mp4", "video/mp4")) return null;
  try {
    const requested = new URL(source["requestedUrl"]), final = new URL(source["finalUrl"]);
    if (!(["127.0.0.1", "[::1]"].includes(requested.hostname) && requested.protocol === "http:" && requested.port &&
      final.origin === requested.origin && source["origin"] === requested.origin)) return null;
  } catch { return null; }
  return value as unknown as CaptureReceipt;
}

export async function readCaptureReceipt(root: string, id: string): Promise<CaptureReceipt | null> {
  if (!CAPTURE_ID.test(id)) return null;
  try {
    const path = join(root, id, "receipt.json");
    if (!(await lstat(path)).isFile()) return null;
    const bytes = await readFile(path);
    if (bytes.byteLength > 64 * 1024) return null;
    return parseReceipt(JSON.parse(bytes.toString("utf8")), id);
  } catch { return null; }
}

export async function listCaptures(root: string): Promise<readonly CaptureReceipt[]> {
  let names: string[];
  try { names = await readdir(root); } catch { return []; }
  const receipts = await Promise.all(names.filter(name => CAPTURE_ID.test(name)).map(name => readCaptureReceipt(root, name)));
  return receipts.filter((value): value is CaptureReceipt => value !== null)
    .sort((a, b) => b.capture.completedAt.localeCompare(a.capture.completedAt));
}

export async function readCaptureArtifact(root: string, id: string, kind: "screenshot" | "video"): Promise<{ bytes: Buffer; mimeType: string } | null> {
  const receipt = await readCaptureReceipt(root, id);
  if (!receipt) return null;
  const artifact = receipt.artifacts[kind];
  try {
    const path = join(root, id, artifact.file);
    const entry = await lstat(path);
    if (!entry.isFile() || entry.size !== artifact.bytes || entry.size > MAX_ARTIFACT_BYTES) return null;
    const bytes = await readFile(path);
    if (`sha256:${createHash("sha256").update(bytes).digest("hex")}` !== artifact.sha256) return null;
    if (kind === "screenshot" && !bytes.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) return null;
    if (kind === "video" && (bytes.length < 12 || bytes.toString("ascii", 4, 8) !== "ftyp")) return null;
    return { bytes, mimeType: artifact.mimeType };
  } catch { return null; }
}

/** A demo's identity covers both artifacts, so an earlier still-only review is never widened. */
export function captureDemoCandidateId(receipt: CaptureReceipt): string {
  const pair = `${receipt.artifacts.screenshot.sha256}\n${receipt.artifacts.video.sha256}`;
  return `demo:sha256:${createHash("sha256").update(pair).digest("hex")}`;
}
