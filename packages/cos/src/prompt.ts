/**
 * HOW A PERSON'S OWN MATERIAL IS PRESENTED TO A MODEL — pure, and extracted so the rule can be
 * tested rather than trusted.
 *
 * F-004, observed in a real run against `llama3.2:3b`: the model replied that it *"considered
 * 'tier1-local,' which suggests that you have some level of seniority or influence"*. It was
 * reading a PRIVACY CLASSIFICATION as a career grade — and then reasoning about the person from it.
 * The label came from the local prompt builder, which prefixed every item with
 * `[<id> — declared <kind>]`.
 *
 * WHY THE KIND MUST NOT BE IN THE PROMPT AT ALL. The declared kind is an EGRESS control: it decides
 * whether an item may leave the machine, and that decision is already made by `route.ts` before any
 * prompt exists. By the time material reaches this function the question the kind answers has been
 * answered. Passing it on gives the model a token it cannot use correctly and demonstrably does use
 * incorrectly — "tier1" looks like a rank in every corpus a model has ever read. A classification
 * that becomes career advice about the person is the exact failure this product exists to refuse.
 *
 * WHY THE ID STAYS. The system prompt asks the model to say which item a statement comes from, and
 * citations are matched back by id (`consultedOf`, `cite`). Removing the id would break attribution,
 * which is the opposite of the goal — the id is a handle, carries no claim about the person, and is
 * the person's own name for their own material.
 *
 * THE REMOTE PATH NEVER HAD THIS BUG, and that is worth stating: `cos.mjs`'s Fireworks branch sends
 * `content: i.body` alone. Two prompt builders, one rule, and they disagreed — so the rule now lives
 * here, in one pure function, and both paths can be pointed at it.
 */

/** The least a prompt builder needs to know about a filed item. */
export interface PromptableItem {
  readonly id: string;
  readonly body: string;
}

/** A chat message, in the shape both model callers already use. */
export interface PromptMessage {
  readonly role: "system" | "user";
  readonly content: string;
}

/**
 * One filed item, as the model sees it.
 *
 * The id is bracketed so it reads as a label rather than as part of the person's prose, and nothing
 * else is added. Anything a caller is tempted to append here — a kind, a date, a confidence — is a
 * token the model will reason about as if it described the PERSON, so the bar for adding one is
 * that it must be about the material and must survive being misread as a claim about them.
 */
export function itemAsPromptContent(item: PromptableItem): string {
  return `[${item.id}]\n${item.body}`;
}

/**
 * The full message list for a model turn: the instruction, the person's material, their request.
 *
 * Total: an empty `items` is an ordinary state — the request alone is a valid turn — and produces
 * a two-message list rather than an error.
 */
export function promptMessages(args: {
  readonly system: string;
  readonly items: readonly PromptableItem[];
  readonly request: string;
}): readonly PromptMessage[] {
  return Object.freeze([
    { role: "system" as const, content: args.system },
    ...args.items.map((i) => ({ role: "user" as const, content: itemAsPromptContent(i) })),
    { role: "user" as const, content: args.request },
  ]);
}
