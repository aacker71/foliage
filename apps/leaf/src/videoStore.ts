/** Private, content-addressed MP4s from owner-selected local captures. */
import { constants } from "node:fs";
import { createHash } from "node:crypto";
import { mkdir, open, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

export const MAX_CAPTURE_VIDEO_BYTES = 64 * 1024 * 1024;
const REF = /^sha256:[0-9a-f]{64}$/;
const GITIGNORE = "# Private captured video. Publication requires separate selection.\n*\n";

export function videoRootFor(leafPath: string): string {
  return join(dirname(resolve(leafPath)), "videos");
}

export function videoRootFromEnv(env: Readonly<Record<string, string | undefined>> = process.env): string {
  const explicit = env["FOLIAGE_VIDEO"]?.trim();
  if (explicit) return resolve(explicit);
  const leaf = env["FOLIAGE_LEAF"]?.trim();
  return videoRootFor(leaf || resolve("apps/leaf/leaf.json"));
}

function videoPath(root: string, ref: string): string {
  if (!REF.test(ref)) throw new Error("A video ref must be a lowercase SHA-256 digest.");
  const hash = ref.slice(7);
  return join(resolve(root), "sha256", hash.slice(0, 2), hash, "video.mp4");
}

interface Box { readonly type: string; readonly start: number; readonly content: number; readonly end: number }
function boxes(bytes: Buffer, from: number, to: number): readonly Box[] | null {
  const result: Box[] = [];
  for (let at = from; at < to;) {
    if (at + 8 > to || result.length > 4096) return null;
    const size = bytes.readUInt32BE(at), type = bytes.toString("ascii", at + 4, at + 8);
    // The encoder writes ordinary bounded boxes. Size zero and extended sizes are refused so
    // a handcrafted file cannot hide a second interpretation of where a box ends.
    if (size < 8 || at + size > to) return null;
    result.push({ type, start: at, content: at + 8, end: at + size });
    at += size;
  }
  return result;
}

/** The exact H.264 video-only MP4 container shape emitted by the capture encoder. */
export function isCapturedMp4(bytes: Buffer): boolean {
  if (bytes.length < 64 || bytes.length > MAX_CAPTURE_VIDEO_BYTES) return false;
  const top = boxes(bytes, 0, bytes.length);
  if (!top || top[0]?.type !== "ftyp" || top[0].end - top[0].content < 8 ||
      !["isom", "iso2", "mp41", "mp42"].includes(bytes.toString("ascii", top[0].content, top[0].content + 4))) return false;
  const moov = top.find(box => box.type === "moov"), mdat = top.find(box => box.type === "mdat");
  if (!moov || !mdat || mdat.end - mdat.content < 1) return false;
  const moovBoxes = boxes(bytes, moov.content, moov.end);
  if (!moovBoxes) return false;
  const tracks = moovBoxes.filter(box => box.type === "trak");
  if (tracks.length !== 1) return false;
  const trak = boxes(bytes, tracks[0]!.content, tracks[0]!.end)?.find(box => box.type === "mdia");
  if (!trak) return false;
  const mdia = boxes(bytes, trak.content, trak.end);
  const handler = mdia?.find(box => box.type === "hdlr");
  const minf = mdia?.find(box => box.type === "minf");
  if (!handler || handler.content + 12 > handler.end ||
      bytes.toString("ascii", handler.content + 8, handler.content + 12) !== "vide" || !minf) return false;
  const stbl = boxes(bytes, minf.content, minf.end)?.find(box => box.type === "stbl");
  if (!stbl) return false;
  const stsd = boxes(bytes, stbl.content, stbl.end)?.find(box => box.type === "stsd");
  if (!stsd || stsd.content + 16 > stsd.end || bytes.readUInt32BE(stsd.content + 4) !== 1) return false;
  const entryAt = stsd.content + 8, entrySize = bytes.readUInt32BE(entryAt);
  if (entrySize < 86 || entryAt + entrySize !== stsd.end ||
      bytes.toString("ascii", entryAt + 4, entryAt + 8) !== "avc1") return false;
  return boxes(bytes, entryAt + 86, entryAt + entrySize)?.some(box => box.type === "avcC") === true;
}

export function videoRef(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export interface CapturedVideoMetadata {
  /** The reviewed still from the same recording, required as the public poster. */
  readonly posterRef: string;
  /** Encoded frames / frame rate from the capture receipt, not an estimate about work. */
  readonly durationSeconds: number;
}

function validMetadata(value: unknown): value is CapturedVideoMetadata {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).length === 2 && "posterRef" in value && "durationSeconds" in value &&
    typeof value.posterRef === "string" && REF.test(value.posterRef) &&
    typeof value.durationSeconds === "number" && Number.isFinite(value.durationSeconds) &&
    value.durationSeconds > 0 && value.durationSeconds <= 30;
}

export async function putCapturedVideo(root: string, bytes: Buffer, metadata: CapturedVideoMetadata): Promise<{ readonly ref: string; readonly bytes: number }> {
  if (!isCapturedMp4(bytes)) {
    throw new Error("Captured video must be a video-only H.264 MP4 of at most 64 MiB.");
  }
  if (!validMetadata(metadata)) throw new Error("Captured video needs a checked poster ref and duration.");
  const ref = videoRef(bytes), path = videoPath(root, ref);
  await mkdir(resolve(root), { recursive: true, mode: 0o700 });
  await writeFile(join(resolve(root), ".gitignore"), GITIGNORE, { flag: "wx", mode: 0o600 }).catch(error => {
    if (!(error && typeof error === "object" && "code" in error && error.code === "EEXIST")) throw error;
  });
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  try {
    await writeFile(path, bytes, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "EEXIST")) throw error;
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const prior = await handle.readFile();
      if (!prior.equals(bytes)) throw new Error("Stored video differs from the selected capture; nothing was replaced.");
    } finally { await handle.close(); }
  }
  const manifest = join(dirname(path), "manifest.json");
  const encoded = `${JSON.stringify({ version: 1, ref, bytes: bytes.length, ...metadata })}\n`;
  try {
    await writeFile(manifest, encoded, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "EEXIST")) throw error;
    const handle = await open(manifest, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      if ((await handle.readFile()).toString("utf8") !== encoded) throw new Error("Stored video metadata differs from the selected capture; nothing was replaced.");
    } finally { await handle.close(); }
  }
  return { ref, bytes: bytes.length };
}

export type VideoRead =
  | { readonly ok: true; readonly ref: string; readonly bytes: Buffer; readonly mimeType: "video/mp4"; readonly metadata: CapturedVideoMetadata }
  | { readonly ok: false; readonly cause: "invalid-ref" | "not-in-store" | "invalid-file" | "digest-mismatch"; readonly detail: string };

export async function readVideo(root: string, ref: string): Promise<VideoRead> {
  if (!REF.test(ref)) return { ok: false, cause: "invalid-ref", detail: "The video reference is not a SHA-256 digest." };
  const path = videoPath(root, ref);
  try {
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size < 12 || info.size > MAX_CAPTURE_VIDEO_BYTES) {
        return { ok: false, cause: "invalid-file", detail: "Stored video is not a bounded regular MP4." };
      }
      const bytes = await handle.readFile();
      if (!isCapturedMp4(bytes)) return { ok: false, cause: "invalid-file", detail: "Stored video is not a video-only H.264 MP4." };
      if (videoRef(bytes) !== ref) return { ok: false, cause: "digest-mismatch", detail: "Stored video bytes do not match their evidence digest." };
      const manifestHandle = await open(join(dirname(path), "manifest.json"), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      let manifest: unknown;
      try {
        const info = await manifestHandle.stat();
        if (!info.isFile() || info.size > 2048) return { ok: false, cause: "invalid-file", detail: "Stored video manifest is invalid." };
        manifest = JSON.parse((await manifestHandle.readFile()).toString("utf8"));
      } catch {
        return { ok: false, cause: "invalid-file", detail: "Stored video manifest is invalid." };
      } finally { await manifestHandle.close(); }
      if (!manifest || typeof manifest !== "object" || Array.isArray(manifest) ||
          Object.keys(manifest).length !== 5 || !("version" in manifest) || manifest.version !== 1 ||
          !("ref" in manifest) || manifest.ref !== ref || !("bytes" in manifest) || manifest.bytes !== bytes.length ||
          !("posterRef" in manifest) || !("durationSeconds" in manifest) ||
          !validMetadata({ posterRef: manifest.posterRef, durationSeconds: manifest.durationSeconds })) {
        return { ok: false, cause: "invalid-file", detail: "Stored video manifest differs from its bytes." };
      }
      return { ok: true, ref, bytes, mimeType: "video/mp4", metadata: { posterRef: manifest.posterRef as string, durationSeconds: manifest.durationSeconds as number } };
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && ["ENOENT", "ELOOP"].includes(String(error.code))) {
      return { ok: false, cause: "not-in-store", detail: "Selected video is unavailable in the private store." };
    }
    throw error;
  }
}
