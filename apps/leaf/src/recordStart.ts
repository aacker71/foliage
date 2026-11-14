/** The record `/leaf/setup` starts from a typed name, and the name a bound review queue needs. Pure. */
import { parseLeafDocument } from "@foliage/leaf";
import type { HarvestDocument } from "@foliage/photosynthesis";

/**
 * The step that creates the missing record, named for its effect. One wording on every surface
 * that leads to it: the Review panel, a refused Add, Overview and Work.
 */
export const CREATE_RECORD = { text: "Create your private record", href: "/leaf/setup" } as const;

/** The first record a typed name starts, or why it cannot start one. `createFirstLeaf` writes exactly this. */
export function firstRecord(name: string): { readonly ok: true; readonly id: string; readonly subject: string } | { readonly ok: false; readonly message: string } {
  const subject = name.trim();
  if (!subject || subject.length > 120 || /[\r\n\0]/u.test(subject)) {
    return { ok: false, message: "Enter your name on one line, up to 120 characters." };
  }
  // Match the intake CLI's default identity so a later source intake addresses this Leaf.
  const id = subject.normalize("NFKD").toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-").replace(/^-+|-+$/g, "");
  if (!id) return { ok: false, message: "Use a name with letters or numbers." };
  if (!parseLeafDocument({ id, subject, leaflets: [] }).ok) {
    return { ok: false, message: "That name could not start a record. Try another spelling." };
  }
  return { ok: true, id, subject };
}

/**
 * The name a new record must be created under for this queue's approved drafts to be added to it.
 *
 * `promoteApproved` refuses a record whose subject or id differs from the queue's binding, and
 * `firstRecord` takes the id from the name. So a bound queue needs its own subject back (`name`),
 * an unbound one adds into a record of any name (`name: null`), and a binding no typed name can
 * meet (an id alone, or an id that name does not give) is not addable: no page may promise the add.
 */
export function recordStart(harvest: Pick<HarvestDocument, "subject" | "leafId">):
  { readonly addable: true; readonly name: string | null } | { readonly addable: false } {
  if (harvest.subject === undefined) return harvest.leafId === undefined ? { addable: true, name: null } : { addable: false };
  const first = firstRecord(harvest.subject);
  return first.ok && first.subject === harvest.subject && (harvest.leafId === undefined || harvest.leafId === first.id)
    ? { addable: true, name: first.subject }
    : { addable: false };
}

/**
 * What happens to approved drafts once the missing record exists, in one sentence every surface
 * shares: added after it is created (under the queue's own name when it is bound to one), or,
 * when no new record can meet the binding, plainly not. `where` ends the add ("from Review").
 */
export function addAfterCreate(harvest: Pick<HarvestDocument, "subject" | "leafId">, approved: number, where: string, counted = true): string {
  const drafts = `${counted ? `${approved.toLocaleString()} ` : ""}approved ${approved === 1 ? "draft" : "drafts"}`;
  const start = recordStart(harvest);
  if (!start.addable) return `Your ${drafts} ${approved === 1 ? "was" : "were"} prepared for another record and can't be added to a new one.`;
  return `Create it${start.name === null ? "" : ` as ${start.name}`}, then add your ${drafts} ${where}.`;
}
