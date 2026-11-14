/**
 * TIER 1 — THE DEVICE-ONLY STORE.
 *
 * This file holds the material the product promises can never leave the machine: raw
 * reflections, review content, the unpolished half of a career. Spec §3 Tier 1 offers two
 * honest resolutions of the durability tradeoff, and this file implements (a) — a
 * user-supplied secret from which the key is derived, so that a backup, a sync folder or a
 * stolen laptop yields ciphertext and nothing else. Foliage never persists, transmits or
 * escrows the secret or the key.
 *
 * THREAT MODEL, stated so the guarantee is not read as bigger than it is.
 *
 *   MODELLED: an adversary who holds the store file. A stolen or lost laptop, a Time Machine
 *   backup, a file that got swept into a cloud-sync folder, a support bundle, a disk sold
 *   without wiping. Against that adversary, everything in this store — the bodies, the
 *   declared kinds, AND the item ids — is unreadable without the secret.
 *
 *   NOT MODELLED, and no line of this file pretends otherwise: an adversary running code on
 *   the machine while the store is open, a keylogger, a memory dump of the live process, or
 *   an operating system that swapped a page of key material to disk. Once a store is open the
 *   derived key exists in this process's heap, because AES needs a key. What is claimed is
 *   narrower and checkable: nothing on disk is readable without the secret, and nothing in
 *   this file can send any of it anywhere.
 *
 * NO NETWORK — STRUCTURALLY, NOT BY PROMISE. This module imports exactly `node:sqlite`,
 * `node:crypto`, `node:fs` and `node:path`. There is no `fetch`, no `node:http`/`https`/`net`/
 * `dgram`/`tls`, no dynamic `import()`, no subprocess. That is not documentation you have to trust:
 * `localStore.test.ts` parses this file's own import specifiers against an exact allow-list
 * and greps for every network-capable global, and fails if one appears. The Tier 1 claim is
 * the one claim in the product that a comment cannot carry — so it is a test.
 *
 * NOTHING RETURNS `T | null`. Every read is a discriminated union with a named cause, the
 * shape `packages/leaf/src/merge.ts` established: "I could not read your file" must not
 * narrow to `null` and fall through to "so there was nothing there". `absent` (you have no
 * such item), `unreadable` (I could not get to it, and here is which failure), and
 * `undecryptable` (the bytes are there and the tag did not verify under this key) are three
 * different facts about someone's private material, and collapsing them is how a product
 * ends up telling a person their reflections were never written down.
 *
 * TOTAL: no exported function throws. Every failure path — a missing file, a file that is
 * not a database, a wrong secret, a corrupted row, a store used after close — returns a
 * result carrying its own cause. A store is the wrong place to make a caller write
 * try/catch around the question "do I have this".
 *
 * =============================================================================
 * THE CRYPTOGRAPHY, AND WHY THESE PARAMETERS
 * =============================================================================
 *
 * KDF: scrypt (RFC 7914) at N = 2^17, r = 8, p = 1, 64-byte output.
 *
 *   WHY scrypt AND NOT PBKDF2. PBKDF2 is what WebCrypto's `subtle.deriveBits` offers, and it
 *   is the wrong tool here: it is compute-hard only, so a GPU or an FPGA farm runs it
 *   thousands of times more efficiently than this laptop does, and the whole security of a
 *   file-at-rest scheme is the cost of guessing a human-chosen passphrase. scrypt is
 *   memory-hard — 128·N·r bytes of working set — which is the property that makes a
 *   guessing rig expensive rather than merely parallel. Argon2id would be the current first
 *   choice, and it is not available: it needs an npm package, and a third-party runtime
 *   dependency in the open plane is a property this repo currently has and would lose.
 *   scrypt ships inside `node:crypto`. That is the real tradeoff and it is the reason.
 *
 *   WHY N = 2^17. Measured on this machine (Apple silicon, Node v22.23.1), 64-byte output,
 *   r = 8, p = 1:
 *
 *       N = 2^14   16 MiB    38 ms
 *       N = 2^15   32 MiB    67 ms
 *       N = 2^16   64 MiB   135 ms
 *       N = 2^17  128 MiB   270 ms
 *
 *   270 ms and 128 MiB is the interactive budget: it is under the ~500 ms where an unlock
 *   starts to feel broken, and it is the parameter set OWASP currently names first for
 *   scrypt. Derivation happens ONCE per open, not per read, so this cost is paid at unlock
 *   and never in the request path. The numbers are recorded because a KDF parameter chosen
 *   without a measurement is a number someone copied.
 *
 *   THE 128 MiB IS NOT OPTIONAL AND IT IS NOT FREE. `node:crypto` defaults `maxmem` to
 *   32 MiB and refuses anything above it, so the call sets `maxmem` explicitly; a machine
 *   too small to allocate that will fail at open with `secret-unusable` and its real cause,
 *   rather than silently dropping to a weaker parameter set. A KDF that quietly weakens
 *   itself under pressure is worse than one that stops.
 *
 *   THE PARAMETERS ARE STORED IN THE FILE, the salt with them. They are not secret — they
 *   are what a future version needs in order to open a store created today, and hard-coding
 *   them into the reader is how a store becomes unopenable the first time the constant moves.
 *
 * CIPHER: AES-256-GCM through WebCrypto, one fresh random 96-bit nonce per record.
 *
 *   96 bits is GCM's native nonce size (no GHASH-based derivation, which is where nonce
 *   reuse risk concentrates). Random nonces under one key collide at the birthday bound:
 *   at 2^32 records the collision probability is around 2^-33. A device-local store of one
 *   person's private notes is many orders of magnitude below that, and this is written down
 *   so that a future change which starts writing machine-generated records at volume knows
 *   which assumption it is spending.
 *
 *   ADDITIONAL AUTHENTICATED DATA binds every ciphertext to the row it lives in and to the
 *   schema version: AAD = "foliage.tier1.v1.record:" + hex(blindId). Without it, an
 *   adversary holding the file could swap two rows' ciphertexts and both would still decrypt
 *   — the store would then confidently hand back one item's body under another item's id.
 *   GCM authenticates the AAD, so that swap now fails as `undecryptable` and says so.
 *
 * IDS ARE BLINDED, NOT STORED. The primary key is HMAC-SHA-256(idKey, id), where idKey is
 * the second half of the scrypt output. The id a caller chose — which in this tier is very
 * plausibly "2026-performance-review" or a person's name — never touches the disk in the
 * clear, and neither does the declared kind, which lives inside the ciphertext with the body.
 *
 *   WHAT THIS COSTS: `list()` must decrypt every record, because there is no plaintext column
 *   to filter on. That is O(n) crypto per listing, on a store sized for one person's private
 *   material; the alternative is a plaintext index that tells whoever holds the file exactly
 *   what the person keeps in it. WHAT IT LEAKS ANYWAY: equality. Two stores under the same
 *   secret produce the same blind id for the same id string, which is precisely what makes
 *   O(1) lookup possible. Row count and approximate record sizes are also visible in the
 *   file. Those are the honest residual leaks; there is no length padding here.
 *
 * THE KEY CHECK IS NOT A SEEDED ROW. `meta.key_check` is a single encrypted constant, and it
 * exists so that opening with the wrong secret fails AT OPEN with `key-mismatch` instead of
 * looking like a store that happens to be empty. It lives in `meta`, never in `item`; a
 * fresh store's `list()` returns `{ state: "empty" }` and its item table has zero rows. It
 * is a cryptographic keycheck, not data, and it is not an example, a demo or a fixture —
 * there is no fake data in this repository and this file did not become the first.
 *
 * COMPLEXITY. open: one scrypt (270 ms) + two HMAC/AES operations, independent of store
 * size. read/put/remove: one HMAC + one AES-GCM operation plus an O(log n) B-tree lookup on
 * the blind-id primary key. list: O(n) rows, one AES-GCM decryption each.
 */

import { chmodSync, closeSync, existsSync, mkdirSync, openSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { scrypt, webcrypto } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

// ---------------------------------------------------------------------------------------
// The public shape
// ---------------------------------------------------------------------------------------

/**
 * One piece of Tier 1 material.
 *
 * `kind` is DECLARED by the caller and never inferred here. A store that guessed how
 * sensitive something was would be making exactly the judgement the router is required to
 * take from the person instead — and it would be guessing from the plaintext it is supposed
 * to be protecting. Adding a field to this shape is a schema change: bump SCHEMA_VERSION, or
 * every store written by the older code becomes unreadable in a way that reports as
 * `record-malformed` and looks like corruption.
 */
export interface Tier1Item {
  /** Caller's identifier. Blinded before it reaches disk; never stored in the clear. */
  readonly id: string;
  /** Caller-declared classification kind. Opaque to this file — it stores, it does not judge. */
  readonly kind: string;
  /** The material itself. */
  readonly body: string;
  /** When the CALLER says this was recorded. This file has no clock and invents no time. */
  readonly recordedAt: string;
}

/**
 * Every named way this store can fail. Nine causes, none of which collapses into another —
 * that is the point. "There is no file", "there is a file and it is not mine", "the secret is
 * wrong" and "this one row is corrupt" demand four different things of the person holding the
 * machine, and a product that answers all four with the same shrug has told them nothing.
 */
export type Tier1FailureCause =
  /** No file at this path, and the caller did not ask to create one. */
  | "no-store-file"
  /** A file is there and it is not a Foliage Tier 1 store — not SQLite, or SQLite without our schema. */
  | "not-a-store"
  /** Our schema, a version this build does not know how to read. Refused rather than guessed at. */
  | "schema-unsupported"
  /** The filesystem or SQLite said no: permissions, a directory, a full or read-only disk. */
  | "io-error"
  /** The secret cannot be used: empty, or the KDF could not run (see `detail` for which). */
  | "secret-unusable"
  /** The store opened and the key check did not authenticate. Wrong secret, or a tampered header. */
  | "key-mismatch"
  /** Used after `close()`. A closed store answers with this rather than reopening behind your back. */
  | "store-closed"
  /** A row's bytes are there and GCM refused them: wrong key, tampering, or bit rot. */
  | "record-undecryptable"
  /** A row decrypted and what came out is not a Tier1Item. Reported, never coerced into one. */
  | "record-malformed"
  /** The caller handed in something that is not a storable item. Refused before any crypto runs. */
  | "item-invalid";

/** The KDF parameters a store was created with, read back off the file it was opened from. */
export interface KdfParameters {
  readonly kdf: "scrypt";
  /** scrypt's N — the CPU/memory cost. Working set is 128 · cost · blockSize bytes. */
  readonly cost: number;
  /** scrypt's r. */
  readonly blockSize: number;
  /** scrypt's p. */
  readonly parallelization: number;
  /** Total derived bytes: the first half keys AES, the second half keys the id HMAC. */
  readonly keyLengthBytes: number;
  /** Per-store random salt, hex. Not secret — without it the store cannot be reopened at all. */
  readonly saltHex: string;
}

export interface OpenOptions {
  /** Path to the store file. */
  readonly path: string;
  /**
   * The user's secret. `Uint8Array` is preferred and the reason is not style: a JavaScript
   * string is immutable, so a passphrase passed as a string cannot be overwritten afterwards
   * and stays in the heap until the collector happens to reclaim it. Bytes handed in here are
   * READ, never retained; this file never copies them anywhere that outlives the call.
   */
  readonly secret: string | Uint8Array;
  /**
   * Create the store if the file is not there. Default FALSE, deliberately: `open` on a
   * mistyped path should report `no-store-file`, not silently hand back a brand-new empty
   * store and let the caller conclude the person's material is gone.
   */
  readonly create?: boolean;
}

/** A store that is open. Every method is total; none of them throws. */
export interface Tier1Store {
  readonly path: string;
  /** The parameters this store's key was actually derived with — read from the file, not assumed. */
  readonly kdf: KdfParameters;
  put(item: Tier1Item): Promise<Tier1WriteResult>;
  read(id: string): Promise<Tier1ReadResult>;
  list(): Promise<Tier1ListResult>;
  remove(id: string): Promise<Tier1RemoveResult>;
  close(): Tier1CloseResult;
}

export type OpenResult =
  | { readonly state: "opened"; readonly store: Tier1Store }
  | { readonly state: "failed"; readonly cause: Tier1FailureCause; readonly detail: string };

/**
 * The result of asking for one item.
 *
 * Four states because there are four facts. `undecryptable` is separate from `unreadable`
 * because it is the only one that means "your material is still here": the row exists, the
 * bytes are intact enough to find, and this key will not open them. That is a recoverable
 * situation for someone who has another secret, and it must never be reported as "absent".
 */
export type Tier1ReadResult =
  | { readonly state: "absent"; readonly id: string }
  | { readonly state: "present"; readonly item: Tier1Item }
  | {
      readonly state: "unreadable";
      readonly id: string;
      readonly cause: Tier1FailureCause;
      readonly detail: string;
    }
  | {
      readonly state: "undecryptable";
      readonly id: string;
      readonly cause: "record-undecryptable" | "record-malformed";
      readonly detail: string;
    };

/**
 * One record a listing could not turn back into an item.
 *
 * It is reported by its blind id — a hex string that means nothing to a human — because the
 * real id lives INSIDE the ciphertext we just failed to open. That is the honest consequence
 * of blinding, and it is better than the alternative: a listing that quietly returns 41 items
 * out of 42 and never mentions the 42nd.
 */
export interface Tier1RecordFailure {
  readonly blindIdHex: string;
  readonly cause: "record-undecryptable" | "record-malformed";
  readonly detail: string;
}

/**
 * The result of listing.
 *
 * `empty` is its own state so that the honest empty surface is something a caller RENDERS
 * rather than something it infers from `items.length === 0` — and so that "you have nothing
 * here yet" can never be produced by a store where everything failed to decrypt. In that
 * case the state is `present`, `items` is empty, and `failed` has 42 entries in it.
 */
export type Tier1ListResult =
  | { readonly state: "empty" }
  | {
      readonly state: "present";
      readonly items: readonly Tier1Item[];
      readonly failed: readonly Tier1RecordFailure[];
    }
  | { readonly state: "unreadable"; readonly cause: Tier1FailureCause; readonly detail: string };

export type Tier1WriteResult =
  | { readonly state: "written"; readonly id: string; readonly replaced: boolean }
  | { readonly state: "refused"; readonly cause: Tier1FailureCause; readonly detail: string };

export type Tier1RemoveResult =
  | { readonly state: "removed"; readonly id: string }
  | { readonly state: "absent"; readonly id: string }
  | { readonly state: "refused"; readonly cause: Tier1FailureCause; readonly detail: string };

export type Tier1CloseResult =
  | { readonly state: "closed" }
  | { readonly state: "already-closed" }
  | { readonly state: "refused"; readonly cause: Tier1FailureCause; readonly detail: string };

// ---------------------------------------------------------------------------------------
// Constants — the format, written down once
// ---------------------------------------------------------------------------------------

/** Bump this whenever `Tier1Item` or the record encoding changes. Old stores then refuse, loudly. */
const SCHEMA_VERSION = "1";
const FORMAT_TAG = "foliage-tier1";

/** AAD prefixes. Changing either of these strings makes every existing store undecryptable. */
const RECORD_AAD_PREFIX = "foliage.tier1.v1.record:";
const KEY_CHECK_AAD = "foliage.tier1.v1.key-check";

/**
 * The constant that proves the key. Its content is irrelevant and its existence is the point:
 * GCM either authenticates it under the derived key or it does not.
 */
const KEY_CHECK_PLAINTEXT = "foliage.tier1.key-check.v1";

/** scrypt, at the parameters measured and justified in the header. */
const KDF_COST = 1 << 17;
const KDF_BLOCK_SIZE = 8;
const KDF_PARALLELIZATION = 1;
const KDF_KEY_LENGTH = 64;
const SALT_BYTES = 16;
const NONCE_BYTES = 12;

const META_KEYS = {
  format: "format",
  schema: "schema",
  kdf: "kdf",
  kdfCost: "kdf_cost",
  kdfBlockSize: "kdf_block_size",
  kdfParallelization: "kdf_parallelization",
  kdfKeyLength: "kdf_key_length",
  kdfSalt: "kdf_salt",
  keyCheckNonce: "key_check_nonce",
  keyCheckCipher: "key_check_cipher",
} as const;

const DDL = `
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS item (
  blind_id   BLOB PRIMARY KEY,
  nonce      BLOB NOT NULL,
  ciphertext BLOB NOT NULL
) STRICT;
`;

// ---------------------------------------------------------------------------------------
// Small helpers. No secret ever passes through the hex path.
// ---------------------------------------------------------------------------------------

const HEX = "0123456789abcdef";

function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) {
    out += HEX[(b >> 4) & 0xf];
    out += HEX[b & 0xf];
  }
  return out;
}

function fromHex(hex: string): Uint8Array | undefined {
  if (hex.length === 0 || hex.length % 2 !== 0) return undefined;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    const byte = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    if (!Number.isInteger(byte)) return undefined;
    out[i] = byte;
  }
  return out;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

/** Describe a thrown value without assuming it is an Error — plenty of things throw strings. */
function describeThrown(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  return `a non-Error value of type ${typeof e}`;
}

/**
 * A store made before stores were created owner-only is 0644, and so is a header-less file that
 * `create` turns into a store (an empty file, or a SQLite database with no header). SQLite writes
 * in place, so unlike the repository's documents (temp file, 0600, rename) no later write ever
 * narrows it; opening is the equivalent moment. Called only once the file is this store: after
 * its key check, or after `create` wrote its header. A mistyped path to someone else's file is
 * refused before either and never re-moded. Best effort: a filesystem without POSIX modes
 * keeps the modes it has, and the store opens either way.
 */
function tightenToOwnerOnly(path: string): void {
  try {
    if ((statSync(path).mode & 0o077) !== 0) chmodSync(path, 0o600);
  } catch {
    // Not a reason to refuse a person their own store; see above.
  }
}

function nonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

// ---------------------------------------------------------------------------------------
// Key derivation
// ---------------------------------------------------------------------------------------

interface DerivedKeys {
  readonly aesKey: webcrypto.CryptoKey;
  readonly idKey: webcrypto.CryptoKey;
}

/**
 * Derive the two keys from the secret and the store's salt.
 *
 * The 64 scrypt bytes are split rather than reused: bytes 0..31 key AES-256-GCM, bytes 32..63
 * key the HMAC-SHA-256 that blinds ids. One key doing two jobs is a habit that eventually
 * meets a construction where it matters; splitting a single derivation costs nothing.
 *
 * Both keys are imported NON-EXTRACTABLE (`extractable: false`), so the CryptoKey handles
 * cannot be exported back to bytes by any later code in this process — including code that
 * did not read this comment. The raw derived bytes are then overwritten with zeroes. Be
 * precise about what that buys: it removes the copy this file controls. It cannot remove a
 * copy the engine made while moving the buffer, and it cannot touch a secret passed in as a
 * string. It is a reduction in residue, not an erasure, and claiming more would be the kind
 * of security theatre this codebase refuses elsewhere.
 */
async function deriveKeys(
  secret: string | Uint8Array,
  salt: Uint8Array,
  params: KdfParameters,
): Promise<{ ok: true; keys: DerivedKeys } | { ok: false; detail: string }> {
  const secretBytes = typeof secret === "string" ? encoder.encode(secret) : secret;
  if (secretBytes.length === 0) {
    return {
      ok: false,
      detail:
        "the secret is empty. An empty secret is refused rather than accepted as a degenerate " +
        "key, because a store that opens with no secret is not encrypted in any sense a person " +
        "would recognise.",
    };
  }

  let derived: Uint8Array;
  try {
    derived = await new Promise<Uint8Array>((resolve, reject) => {
      scrypt(
        secretBytes,
        salt,
        params.keyLengthBytes,
        {
          N: params.cost,
          r: params.blockSize,
          p: params.parallelization,
          // node:crypto caps scrypt memory at 32 MiB by default and REFUSES anything above
          // it. Our working set is 128 · N · r = 128 MiB, so the cap is raised explicitly
          // with headroom. If a machine cannot allocate it, this rejects and the caller gets
          // `secret-unusable` with the real reason — it never falls back to weaker parameters.
          maxmem: 256 * params.cost * params.blockSize + (1 << 20),
        },
        (err, key) => {
          if (err) reject(err);
          else resolve(new Uint8Array(key.buffer, key.byteOffset, key.byteLength));
        },
      );
    });
  } catch (e) {
    return { ok: false, detail: `scrypt could not run: ${describeThrown(e)}` };
  }

  try {
    const aesKey = await webcrypto.subtle.importKey(
      "raw",
      derived.slice(0, 32),
      { name: "AES-GCM" },
      false,
      ["encrypt", "decrypt"],
    );
    const idKey = await webcrypto.subtle.importKey(
      "raw",
      derived.slice(32, 64),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    return { ok: true, keys: { aesKey, idKey } };
  } catch (e) {
    return { ok: false, detail: `the derived key could not be imported: ${describeThrown(e)}` };
  } finally {
    derived.fill(0);
  }
}

/** HMAC-SHA-256 over the caller's id. Deterministic under one key — that is what makes lookup O(1). */
async function blindId(idKey: webcrypto.CryptoKey, id: string): Promise<Uint8Array> {
  const mac = await webcrypto.subtle.sign("HMAC", idKey, encoder.encode(id));
  return new Uint8Array(mac);
}

async function seal(
  aesKey: webcrypto.CryptoKey,
  plaintext: Uint8Array,
  aad: string,
): Promise<{ nonce: Uint8Array; ciphertext: Uint8Array }> {
  const nonce = webcrypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const ct = await webcrypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, additionalData: encoder.encode(aad) },
    aesKey,
    plaintext,
  );
  return { nonce, ciphertext: new Uint8Array(ct) };
}

/**
 * Open a sealed record. Returns `undefined` on ANY authentication failure and the caller turns
 * that into a named cause — this is the one place a boolean-ish answer is right, because GCM
 * genuinely cannot tell "wrong key" from "flipped bit" from "swapped row", and inventing a
 * distinction it does not have would be exactly the error-masking this repo keeps paying for.
 */
async function unseal(
  aesKey: webcrypto.CryptoKey,
  nonce: Uint8Array,
  ciphertext: Uint8Array,
  aad: string,
): Promise<Uint8Array | undefined> {
  try {
    const pt = await webcrypto.subtle.decrypt(
      { name: "AES-GCM", iv: nonce, additionalData: encoder.encode(aad) },
      aesKey,
      ciphertext,
    );
    return new Uint8Array(pt);
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------------------
// Record encoding
// ---------------------------------------------------------------------------------------

/**
 * Encode an item for sealing. Fixed key order, so the same item produces the same plaintext —
 * which matters only for reasoning about the format, never for the ciphertext, since the nonce
 * is fresh every time.
 */
function encodeItem(item: Tier1Item): Uint8Array {
  return encoder.encode(
    JSON.stringify({
      id: item.id,
      kind: item.kind,
      body: item.body,
      recordedAt: item.recordedAt,
    }),
  );
}

/**
 * Turn decrypted bytes back into an item, or say why they are not one.
 *
 * A record that authenticated but does not parse is NOT corruption in the cryptographic sense
 * — the tag verified, so these are the bytes we wrote. It means a schema moved underneath the
 * file. Reported as `record-malformed` and never coerced: filling in a missing field with ""
 * would put a fabricated value into someone's private record.
 */
function decodeItem(bytes: Uint8Array): { ok: true; item: Tier1Item } | { ok: false; detail: string } {
  let text: string;
  try {
    text = decoder.decode(bytes);
  } catch (e) {
    return { ok: false, detail: `the record authenticated but is not valid UTF-8: ${describeThrown(e)}` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { ok: false, detail: `the record authenticated but is not valid JSON: ${describeThrown(e)}` };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, detail: "the record authenticated and is not a JSON object" };
  }
  const rec = parsed as Record<string, unknown>;
  const missing = (["id", "kind", "body", "recordedAt"] as const).filter(
    (k) => !(k === "body" ? typeof rec[k] === "string" : nonEmptyString(rec[k])),
  );
  if (missing.length > 0) {
    return {
      ok: false,
      detail:
        `the record authenticated and is missing or mistyped: ${missing.join(", ")}. ` +
        `This is a schema change, not corruption — the bytes are exactly what was written.`,
    };
  }
  return {
    ok: true,
    item: {
      id: rec["id"] as string,
      kind: rec["kind"] as string,
      body: rec["body"] as string,
      recordedAt: rec["recordedAt"] as string,
    },
  };
}

/** Refuse an unstorable item before any crypto runs, and say which field. */
function validateItem(item: Tier1Item): string | undefined {
  if (typeof item !== "object" || item === null) return "the item is not an object";
  if (!nonEmptyString(item.id)) return "`id` must be a non-empty string";
  if (!nonEmptyString(item.kind)) return "`kind` must be a non-empty string — it is DECLARED by you, never inferred here";
  if (typeof item.body !== "string") return "`body` must be a string (an empty body is allowed; an absent one is not)";
  if (!nonEmptyString(item.recordedAt)) return "`recordedAt` must be a non-empty string — this file has no clock and will not invent one";
  return undefined;
}

// ---------------------------------------------------------------------------------------
// Opening
// ---------------------------------------------------------------------------------------

function readMeta(db: DatabaseSync): Map<string, string> {
  const rows = db.prepare("SELECT key, value FROM meta").all() as unknown as ReadonlyArray<{
    key: unknown;
    value: unknown;
  }>;
  const out = new Map<string, string>();
  for (const row of rows) {
    if (typeof row.key === "string" && typeof row.value === "string") out.set(row.key, row.value);
  }
  return out;
}

/**
 * Open — or, with `create: true`, create — a Tier 1 store.
 *
 * The order here is load-bearing. The salt and KDF parameters come OFF THE FILE before any
 * derivation, so a store created under different parameters still opens; deriving first with
 * today's constants is how a format upgrade silently locks people out of their own material.
 */
export async function openTier1Store(options: OpenOptions): Promise<OpenResult> {
  const { path, secret } = options;
  const create = options.create === true;

  if (!nonEmptyString(path)) {
    return { state: "failed", cause: "io-error", detail: "`path` must be a non-empty string" };
  }

  let exists: boolean;
  try {
    exists = existsSync(path);
  } catch (e) {
    return { state: "failed", cause: "io-error", detail: `could not stat ${path}: ${describeThrown(e)}` };
  }

  if (!exists && !create) {
    return {
      state: "failed",
      cause: "no-store-file",
      detail:
        `there is no store at ${path}, and \`create\` was not set. This is refused rather than ` +
        `answered with a fresh empty store, because a typo in a path must not look like ` +
        `"your material is gone".`,
    };
  }

  if (!exists) {
    // OWNER-ONLY FROM THE FIRST BYTE. Left to itself SQLite creates the file 0644, readable by
    // every account on the machine: ciphertext, but ciphertext anyone can copy and attack
    // offline. So the empty file is made here, 0600, and SQLite opens it as a new database (its
    // journal takes the same mode). A directory this creates is 0700; one that exists is left
    // exactly as it is, because it is the person's and not this store's.
    try {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      closeSync(openSync(path, "wx", 0o600));
    } catch (e) {
      return { state: "failed", cause: "io-error", detail: `could not create ${path}: ${describeThrown(e)}` };
    }
  }

  let db: DatabaseSync;
  try {
    db = new DatabaseSync(path);
    db.exec(DDL);
  } catch (e) {
    const detail = describeThrown(e);
    // SQLite says "file is not a database" for anything that is not one. Everything else at
    // this point — a directory, no permission, a read-only volume — is genuinely I/O.
    const cause: Tier1FailureCause = /not a database|file is encrypted|malformed/i.test(detail)
      ? "not-a-store"
      : "io-error";
    return {
      state: "failed",
      cause,
      detail:
        cause === "not-a-store"
          ? `${path} exists and is not a Foliage Tier 1 store: ${detail}`
          : `could not open ${path}: ${detail}`,
    };
  }

  const closeQuietly = (): void => {
    try {
      db.close();
    } catch {
      // Already closing down a failed open; there is nothing useful left to report.
    }
  };

  let meta: Map<string, string>;
  try {
    meta = readMeta(db);
  } catch (e) {
    closeQuietly();
    return { state: "failed", cause: "io-error", detail: `could not read the store header: ${describeThrown(e)}` };
  }

  const isNew = meta.size === 0;
  if (isNew && !create) {
    closeQuietly();
    return {
      state: "failed",
      cause: "not-a-store",
      detail: `${path} is a SQLite database with no Foliage Tier 1 header in it`,
    };
  }

  let params: KdfParameters;
  let salt: Uint8Array;

  if (isNew) {
    salt = webcrypto.getRandomValues(new Uint8Array(SALT_BYTES));
    params = {
      kdf: "scrypt",
      cost: KDF_COST,
      blockSize: KDF_BLOCK_SIZE,
      parallelization: KDF_PARALLELIZATION,
      keyLengthBytes: KDF_KEY_LENGTH,
      saltHex: toHex(salt),
    };
  } else {
    if (meta.get(META_KEYS.format) !== FORMAT_TAG) {
      closeQuietly();
      return {
        state: "failed",
        cause: "not-a-store",
        detail: `${path} is a SQLite database whose header says format=${String(meta.get(META_KEYS.format))}`,
      };
    }
    const schema = meta.get(META_KEYS.schema);
    if (schema !== SCHEMA_VERSION) {
      closeQuietly();
      return {
        state: "failed",
        cause: "schema-unsupported",
        detail:
          `this store is schema ${String(schema)} and this build reads schema ${SCHEMA_VERSION}. ` +
          `Refused rather than read optimistically: a newer store opened by older code is how ` +
          `a person's material gets silently truncated.`,
      };
    }
    const saltHex = meta.get(META_KEYS.kdfSalt);
    const decodedSalt = saltHex === undefined ? undefined : fromHex(saltHex);
    const cost = Number(meta.get(META_KEYS.kdfCost));
    const blockSize = Number(meta.get(META_KEYS.kdfBlockSize));
    const parallelization = Number(meta.get(META_KEYS.kdfParallelization));
    const keyLengthBytes = Number(meta.get(META_KEYS.kdfKeyLength));
    if (
      meta.get(META_KEYS.kdf) !== "scrypt" ||
      decodedSalt === undefined ||
      !Number.isInteger(cost) ||
      !Number.isInteger(blockSize) ||
      !Number.isInteger(parallelization) ||
      keyLengthBytes !== KDF_KEY_LENGTH
    ) {
      closeQuietly();
      return {
        state: "failed",
        cause: "not-a-store",
        detail: `${path} has a Foliage header with unusable KDF parameters in it`,
      };
    }
    salt = decodedSalt;
    params = { kdf: "scrypt", cost, blockSize, parallelization, keyLengthBytes, saltHex: toHex(salt) };
  }

  const derived = await deriveKeys(secret, salt, params);
  if (!derived.ok) {
    closeQuietly();
    return { state: "failed", cause: "secret-unusable", detail: derived.detail };
  }
  const { aesKey, idKey } = derived.keys;

  if (isNew) {
    try {
      const check = await seal(aesKey, encoder.encode(KEY_CHECK_PLAINTEXT), KEY_CHECK_AAD);
      const put = db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)");
      put.run(META_KEYS.format, FORMAT_TAG);
      put.run(META_KEYS.schema, SCHEMA_VERSION);
      put.run(META_KEYS.kdf, "scrypt");
      put.run(META_KEYS.kdfCost, String(params.cost));
      put.run(META_KEYS.kdfBlockSize, String(params.blockSize));
      put.run(META_KEYS.kdfParallelization, String(params.parallelization));
      put.run(META_KEYS.kdfKeyLength, String(params.keyLengthBytes));
      put.run(META_KEYS.kdfSalt, params.saltHex);
      put.run(META_KEYS.keyCheckNonce, toHex(check.nonce));
      put.run(META_KEYS.keyCheckCipher, toHex(check.ciphertext));
    } catch (e) {
      closeQuietly();
      return { state: "failed", cause: "io-error", detail: `could not write the store header: ${describeThrown(e)}` };
    }
  } else {
    const nonceHex = meta.get(META_KEYS.keyCheckNonce);
    const cipherHex = meta.get(META_KEYS.keyCheckCipher);
    const nonce = nonceHex === undefined ? undefined : fromHex(nonceHex);
    const cipher = cipherHex === undefined ? undefined : fromHex(cipherHex);
    if (nonce === undefined || cipher === undefined) {
      closeQuietly();
      return { state: "failed", cause: "not-a-store", detail: `${path} has a Foliage header with no key check in it` };
    }
    const opened = await unseal(aesKey, nonce, cipher, KEY_CHECK_AAD);
    if (opened === undefined) {
      closeQuietly();
      return {
        state: "failed",
        cause: "key-mismatch",
        detail:
          `the key derived from this secret does not open ${path}. The store is intact; this ` +
          `secret is not the one it was created with. Nothing was read and nothing was changed.`,
      };
    }
  }

  // Both ways in: an existing store its secret opened, and a file `create` just made a store.
  tightenToOwnerOnly(path);
  return { state: "opened", store: makeStore(path, db, params, aesKey, idKey) };
}

// ---------------------------------------------------------------------------------------
// The open store
// ---------------------------------------------------------------------------------------

function makeStore(
  path: string,
  db: DatabaseSync,
  kdf: KdfParameters,
  aesKey: webcrypto.CryptoKey,
  idKey: webcrypto.CryptoKey,
): Tier1Store {
  let closed = false;

  const closedRefusal = (op: string): { cause: Tier1FailureCause; detail: string } => ({
    cause: "store-closed",
    detail: `${op} was called on a store that has been closed. It is not reopened implicitly.`,
  });

  return {
    path,
    kdf,

    async put(item: Tier1Item): Promise<Tier1WriteResult> {
      if (closed) return { state: "refused", ...closedRefusal("put") };
      const invalid = validateItem(item);
      if (invalid !== undefined) return { state: "refused", cause: "item-invalid", detail: invalid };
      try {
        const blind = await blindId(idKey, item.id);
        const existing = db.prepare("SELECT 1 AS present FROM item WHERE blind_id = ?").get(blind);
        const { nonce, ciphertext } = await seal(
          aesKey,
          encodeItem(item),
          RECORD_AAD_PREFIX + toHex(blind),
        );
        db.prepare(
          "INSERT INTO item (blind_id, nonce, ciphertext) VALUES (?, ?, ?) " +
            "ON CONFLICT(blind_id) DO UPDATE SET nonce = excluded.nonce, ciphertext = excluded.ciphertext",
        ).run(blind, nonce, ciphertext);
        return { state: "written", id: item.id, replaced: existing !== undefined };
      } catch (e) {
        return { state: "refused", cause: "io-error", detail: `could not write to ${path}: ${describeThrown(e)}` };
      }
    },

    async read(id: string): Promise<Tier1ReadResult> {
      if (closed) return { state: "unreadable", id, ...closedRefusal("read") };
      if (!nonEmptyString(id)) {
        return { state: "unreadable", id, cause: "item-invalid", detail: "`id` must be a non-empty string" };
      }
      let row: { nonce: unknown; ciphertext: unknown } | undefined;
      let blindHex: string;
      try {
        const blind = await blindId(idKey, id);
        blindHex = toHex(blind);
        row = db.prepare("SELECT nonce, ciphertext FROM item WHERE blind_id = ?").get(blind) as
          | { nonce: unknown; ciphertext: unknown }
          | undefined;
      } catch (e) {
        return { state: "unreadable", id, cause: "io-error", detail: `could not read from ${path}: ${describeThrown(e)}` };
      }
      if (row === undefined) return { state: "absent", id };
      if (!(row.nonce instanceof Uint8Array) || !(row.ciphertext instanceof Uint8Array)) {
        return {
          state: "unreadable",
          id,
          cause: "io-error",
          detail: "the row exists and its columns are not the byte blobs this format writes",
        };
      }
      const opened = await unseal(aesKey, row.nonce, row.ciphertext, RECORD_AAD_PREFIX + blindHex);
      if (opened === undefined) {
        return {
          state: "undecryptable",
          id,
          cause: "record-undecryptable",
          detail:
            `the record for "${id}" is present and did not authenticate. AES-GCM cannot tell a ` +
            `wrong key from a tampered or bit-rotted record, so this reports what is actually ` +
            `known: the bytes are there and this key will not open them.`,
        };
      }
      const decoded = decodeItem(opened);
      if (!decoded.ok) {
        return { state: "undecryptable", id, cause: "record-malformed", detail: decoded.detail };
      }
      return { state: "present", item: decoded.item };
    },

    async list(): Promise<Tier1ListResult> {
      if (closed) return { state: "unreadable", ...closedRefusal("list") };
      let rows: ReadonlyArray<{ blind_id: unknown; nonce: unknown; ciphertext: unknown }>;
      try {
        rows = db.prepare("SELECT blind_id, nonce, ciphertext FROM item").all() as unknown as ReadonlyArray<{
          blind_id: unknown;
          nonce: unknown;
          ciphertext: unknown;
        }>;
      } catch (e) {
        return { state: "unreadable", cause: "io-error", detail: `could not read from ${path}: ${describeThrown(e)}` };
      }
      // The honest empty state. Zero rows is a fact about the store, not a decrypt failure,
      // and it is reported as its own state so a caller renders "nothing here yet" only when
      // that is true.
      if (rows.length === 0) return { state: "empty" };

      const items: Tier1Item[] = [];
      const failed: Tier1RecordFailure[] = [];
      for (const row of rows) {
        if (
          !(row.blind_id instanceof Uint8Array) ||
          !(row.nonce instanceof Uint8Array) ||
          !(row.ciphertext instanceof Uint8Array)
        ) {
          failed.push({
            blindIdHex: "(unreadable row key)",
            cause: "record-malformed",
            detail: "a row's columns are not the byte blobs this format writes",
          });
          continue;
        }
        const blindHex = toHex(row.blind_id);
        const opened = await unseal(aesKey, row.nonce, row.ciphertext, RECORD_AAD_PREFIX + blindHex);
        if (opened === undefined) {
          failed.push({
            blindIdHex: blindHex,
            cause: "record-undecryptable",
            detail:
              "this record did not authenticate under the open store's key. Its real id is inside " +
              "the ciphertext, so it can only be named by its blind id here.",
          });
          continue;
        }
        const decoded = decodeItem(opened);
        if (decoded.ok) items.push(decoded.item);
        else failed.push({ blindIdHex: blindHex, cause: "record-malformed", detail: decoded.detail });
      }
      return { state: "present", items, failed };
    },

    async remove(id: string): Promise<Tier1RemoveResult> {
      if (closed) return { state: "refused", ...closedRefusal("remove") };
      if (!nonEmptyString(id)) {
        return { state: "refused", cause: "item-invalid", detail: "`id` must be a non-empty string" };
      }
      try {
        const blind = await blindId(idKey, id);
        const result = db.prepare("DELETE FROM item WHERE blind_id = ?").run(blind);
        return Number(result.changes) > 0 ? { state: "removed", id } : { state: "absent", id };
      } catch (e) {
        return { state: "refused", cause: "io-error", detail: `could not delete from ${path}: ${describeThrown(e)}` };
      }
    },

    close(): Tier1CloseResult {
      if (closed) return { state: "already-closed" };
      try {
        db.close();
        closed = true;
        return { state: "closed" };
      } catch (e) {
        return { state: "refused", cause: "io-error", detail: `could not close ${path}: ${describeThrown(e)}` };
      }
    },
  };
}
