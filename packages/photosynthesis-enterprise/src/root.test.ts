import { test } from "node:test";
import assert from "node:assert/strict";

// Imported from the OPEN PLANE on purpose: the score list this parser refuses by name is
// @foliage/leaf's own, and these tests drive every member of it so the claim "one list, four
// gates" is checked by behaviour rather than by a comment.
import { PROOF_TIERS, SCORE_SHAPED } from "@foliage/leaf";

import { parseEnterpriseDocument, type EnterpriseArtifact } from "./artifactDocument.ts";
import { boughId, branchId, leafId, treeId, type Subject } from "./subject.ts";
import {
  drawFromRoot,
  isHonestlyEmpty,
  mcpRootId,
  mcpServerId,
  mcpToolName,
  parseMcpRootDocument,
  type McpDraw,
  type McpObservation,
  type McpPage,
  type McpRoot,
  type McpRootDocumentParse,
} from "./root.ts";

/**
 * THE SERVER IN THESE TESTS IS A REAL ONE, and that is the only honest grounding available on
 * this machine. No Atlassian or WorkIQ MCP server is reachable here, so nothing below claims to
 * have talked to one. What IS real: `gbrain serve` is an MCP server installed on this machine,
 * and on 2026-08-17 a hand-written JSON-RPC `initialize` + `tools/list` against it returned 106
 * tools — among them `search`, whose input schema is `{query, limit, offset, mode}` with `query`
 * required, and `takes_scorecard`. Those measured facts are what the declarations here describe.
 *
 * Every tree, bough, branch and person id is a TEST INPUT chosen to pin one decision. Nothing
 * here describes a real company, team or person, and no observation below was drawn from a real
 * upstream record — `drawFromRoot` is a pure function and these are its inputs.
 */

const ACME = treeId("acme");
const OTHER = treeId("other-co");
const PAYMENTS = boughId("payments");
const BILLING = branchId("billing-core");

const treeOf = (t = ACME): Subject => ({ kind: "tree", tree: t });
const boughOf = (b = PAYMENTS, t = ACME): Subject => ({ kind: "bough", tree: t, bough: b });
const branchOf = (b = BILLING, o = PAYMENTS, t = ACME): Subject => ({
  kind: "branch",
  tree: t,
  bough: o,
  branch: b,
});
const personOf = (id: string, t = ACME): Subject => ({
  kind: "leaf",
  tree: t,
  leaf: leafId(id),
  branches: [{ tree: t, bough: PAYMENTS, branch: BILLING }],
});

/** The measured gbrain server, declared as a root. Its endpoint is stdio and it is local. */
function rootDeclaration(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "gbrain-local",
    tree: "acme",
    server: {
      id: "gbrain",
      endpoint: { transport: "stdio", command: "gbrain serve" },
    },
    tools: [
      { tool: "search", purpose: "read notes the team already wrote, as candidate material" },
    ],
    attributesTo: { kind: "branch", tree: "acme", bough: "payments", branch: "billing-core" },
    grant: {
      kind: "inherited-session",
      principal: "operator@acme.example",
      declaredBy: "platform-eng",
      declaredAt: "2026-08-17T10:00:00Z",
    },
    ...overrides,
  };
}

function parseOne(root: Record<string, unknown>): McpRootDocumentParse {
  return parseMcpRootDocument({ roots: [root] });
}

function firstRoot(root: Record<string, unknown> = rootDeclaration()): McpRoot {
  const parsed = parseOne(root);
  assert.ok(parsed.ok, parsed.ok ? "" : parsed.issues.map((i) => `${i.at}: ${i.message}`).join("\n"));
  const first = parsed.document.roots[0];
  assert.ok(first !== undefined);
  return first;
}

function issuesOf(parsed: McpRootDocumentParse): readonly { at: string; message: string }[] {
  assert.ok(!parsed.ok, "expected a refusal");
  return parsed.issues;
}

function issueAt(parsed: McpRootDocumentParse, at: string): string {
  const found = issuesOf(parsed).find((i) => i.at === at);
  assert.ok(
    found !== undefined,
    `no issue at "${at}"; got ${issuesOf(parsed)
      .map((i) => i.at)
      .join(", ")}`,
  );
  return found.message;
}

const observation = (
  upstreamId: string,
  title = "",
  fields: readonly { label: string; text: string }[] = [],
): McpObservation => ({ upstreamId, title, fields });

function page(overrides: Partial<McpPage> = {}): McpPage {
  return {
    root: mcpRootId("gbrain-local"),
    tool: mcpToolName("search"),
    attributesTo: branchOf(),
    observations: [observation("note:billing-migration", "Billing platform migration notes")],
    remainder: { kind: "exhausted", why: "the tool returned fewer rows than the limit asked for" },
    interruptions: [],
    observedAt: "2026-08-17T10:05:00Z",
    ...overrides,
  };
}

/**
 * The whole point of this lane, asserted about EVERY artifact any draw produces: an MCP root
 * cannot assert a tier, cannot attribute work to a person, and cannot leave the internal state.
 */
function assertNeverProof(artifacts: readonly EnterpriseArtifact[]): void {
  for (const artifact of artifacts) {
    assert.equal(artifact.review.state, "candidate");
    assert.equal(artifact.release, "internal");
    assert.deepEqual(artifact.contributors, []);
  }
}

function drawnArtifacts(draw: McpDraw): readonly EnterpriseArtifact[] {
  assert.ok(draw.ok, draw.ok ? "" : `refused: ${draw.cause}`);
  return draw.completeness === "complete" ? draw.artifacts : draw.artifactsSoFar;
}

// ---------------------------------------------------------------------------------------------
// The declaration document.
// ---------------------------------------------------------------------------------------------

test("a real root declaration parses: the gbrain MCP server, one permitted tool", () => {
  const root = firstRoot();
  assert.equal(root.id, "gbrain-local");
  assert.equal(root.tree, "acme");
  assert.equal(root.server.id, "gbrain");
  assert.equal(root.server.endpoint.transport, "stdio");
  assert.equal(root.tools.length, 1);
  assert.equal(root.tools[0]?.tool, "search");
  assert.equal(root.attributesTo.kind, "branch");
  assert.equal(root.grant.kind, "inherited-session");
});

test("an empty roots array is an honest empty declaration, not a missing one", () => {
  const empty = parseMcpRootDocument({ roots: [] });
  assert.ok(empty.ok);
  assert.deepEqual(empty.document.roots, []);

  const missing = parseMcpRootDocument({});
  assert.match(issueAt(missing, "roots"), /honest empty state/);
});

test("a non-object document is refused with one issue naming what arrived", () => {
  for (const value of [null, "roots", 7, []]) {
    const parsed = parseMcpRootDocument(value);
    assert.ok(!parsed.ok);
    assert.equal(parsed.issues.length, 1);
    assert.equal(parsed.issues[0]?.at, "(document)");
  }
});

test("unknown fields are refused rather than ignored", () => {
  const parsed = parseOne(rootDeclaration({ enabled: true }));
  assert.match(issueAt(parsed, "roots[0].enabled"), /unknown field "enabled"/);
});

test("EVERY score-shaped key is refused BY NAME — the imported list, not a copy", () => {
  // Drives @foliage/leaf's own SCORE_SHAPED so this gate cannot drift from the other three.
  for (const key of SCORE_SHAPED) {
    const parsed = parseOne(rootDeclaration({ [key]: 1 }));
    const message = issueAt(parsed, `roots[0].${key}`);
    assert.match(message, /refused by name/, `"${key}" should be refused by name`);
    assert.doesNotMatch(message, /unknown field/, `"${key}" should not read as a typo`);
  }
});

test("credential-shaped keys are refused by name, with the reason a token has no home here", () => {
  for (const key of ["token", "apiKey", "api_key", "authorization", "clientSecret", "headers"]) {
    const parsed = parseOne(rootDeclaration({ [key]: "…" }));
    const message = issueAt(parsed, `roots[0].${key}`);
    assert.match(message, /no credential belongs in a root declaration/, key);
  }
  // The list can only ever improve the message: each of these is already an unknown field.
  const unknown = parseOne(rootDeclaration({ tokenish: "…" }));
  assert.match(issueAt(unknown, "roots[0].tokenish"), /unknown field/);
});

test("an allow-list with nothing on it is refused — the one place empty is not honest", () => {
  const parsed = parseOne(rootDeclaration({ tools: [] }));
  assert.match(issueAt(parsed, "roots[0].tools"), /at least one tool/);
  assert.match(issueAt(parsed, "roots[0].tools"), /NOT the honest empty state/);
});

test("a tool permit requires a stated purpose, and no tool may be permitted twice", () => {
  const noPurpose = parseOne(rootDeclaration({ tools: [{ tool: "search" }] }));
  assert.match(issueAt(noPurpose, "roots[0].tools[0].purpose"), /in the tenant's own words/);

  const twice = parseOne(
    rootDeclaration({
      tools: [
        { tool: "search", purpose: "read notes" },
        { tool: "search", purpose: "read something else" },
      ],
    }),
  );
  assert.match(issueAt(twice, "roots[0].tools[1].tool"), /already permitted/);
});

test("duplicate root ids are refused within one document", () => {
  const parsed = parseMcpRootDocument({ roots: [rootDeclaration(), rootDeclaration()] });
  assert.match(issueAt(parsed, "roots[1].id"), /duplicate id "gbrain-local"/);
});

// ---------------------------------------------------------------------------------------------
// The endpoint, checked by PARSING it.
// ---------------------------------------------------------------------------------------------

const httpRoot = (url: string): Record<string, unknown> =>
  rootDeclaration({ server: { id: "atlassian-prod", endpoint: { transport: "http", url } } });

test("https to a remote server is accepted; plaintext http to a remote server is not", () => {
  const ok = firstRoot(httpRoot("https://mcp.example.com/mcp"));
  assert.deepEqual(ok.server.endpoint, { transport: "http", url: "https://mcp.example.com/mcp" });

  const plaintext = parseOne(httpRoot("http://mcp.example.com/mcp"));
  assert.match(issueAt(plaintext, "roots[0].server.endpoint.url"), /only to the loopback/);
});

test("plaintext http IS accepted on the loopback interface, where nothing leaves the machine", () => {
  // The real local case: `gbrain serve --http` binds 127.0.0.1.
  for (const url of ["http://127.0.0.1:11434/mcp", "http://[::1]:9010/mcp", "http://localhost/mcp"]) {
    const root = firstRoot(httpRoot(url));
    assert.equal(root.server.endpoint.transport, "http");
  }
});

test("THE HOSTNAME IS PARSED, NOT MATCHED — a host that merely contains 127.0.0.1 is refused", () => {
  const parsed = parseOne(httpRoot("http://127.0.0.1.evil.example/mcp"));
  const message = issueAt(parsed, "roots[0].server.endpoint.url");
  assert.match(message, /PARSED hostname/);
  assert.match(message, /127\.0\.0\.1\.evil\.example/);
});

test("credentials in the URL are refused, and an unparseable URL fails closed", () => {
  const userinfo = parseOne(httpRoot("https://svc:hunter2@mcp.example.com/mcp"));
  assert.match(issueAt(userinfo, "roots[0].server.endpoint.url"), /userinfo/);

  const garbage = parseOne(httpRoot("mcp.example.com/mcp"));
  assert.match(issueAt(garbage, "roots[0].server.endpoint.url"), /cannot be parsed/);

  const scheme = parseOne(httpRoot("ftp://mcp.example.com/mcp"));
  assert.match(issueAt(scheme, "roots[0].server.endpoint.url"), /not an MCP HTTP transport scheme/);
});

test("a stdio endpoint needs a command, and an unknown transport is refused", () => {
  const blank = parseOne(
    rootDeclaration({ server: { id: "gbrain", endpoint: { transport: "stdio", command: "" } } }),
  );
  assert.match(issueAt(blank, "roots[0].server.endpoint.command"), /command that starts the server/);

  const bogus = parseOne(
    rootDeclaration({ server: { id: "gbrain", endpoint: { transport: "websocket", url: "x" } } }),
  );
  assert.match(issueAt(bogus, "roots[0].server.endpoint.transport"), /"stdio", "http"/);
});

// ---------------------------------------------------------------------------------------------
// The scope grant.
// ---------------------------------------------------------------------------------------------

test("a service principal REQUIRES a re-checkable authorisation ref; an inherited session does not", () => {
  const withoutRef = parseOne(
    rootDeclaration({
      grant: {
        kind: "service-principal",
        principal: "svc-portfolio",
        declaredBy: "platform-eng",
        declaredAt: "2026-08-17T10:00:00Z",
      },
    }),
  );
  const message = issueAt(withoutRef, "roots[0].grant.authorisationRef");
  assert.match(message, /reads on behalf of many people/);

  const withRef = firstRoot(
    rootDeclaration({
      grant: {
        kind: "service-principal",
        principal: "svc-portfolio",
        declaredBy: "platform-eng",
        declaredAt: "2026-08-17T10:00:00Z",
        authorisationRef: "SEC-4417",
      },
    }),
  );
  assert.equal(withRef.grant.kind, "service-principal");
});

test("declaredAt must be an instant with an offset — a local timestamp is an assumption", () => {
  const parsed = parseOne(
    rootDeclaration({
      grant: {
        kind: "inherited-session",
        principal: "operator@acme.example",
        declaredBy: "platform-eng",
        declaredAt: "2026-08-17 10:00",
      },
    }),
  );
  assert.match(issueAt(parsed, "roots[0].grant.declaredAt"), /ISO-8601 instant with an offset/);
});

// ---------------------------------------------------------------------------------------------
// Tenancy at the declaration door — one containment rule, not a second copy.
// ---------------------------------------------------------------------------------------------

test("a root may not attribute its material to another company's subject", () => {
  const parsed = parseOne(
    rootDeclaration({
      attributesTo: { kind: "branch", tree: "other-co", bough: "payments", branch: "billing-core" },
    }),
  );
  const message = issueAt(parsed, "roots[0].attributesTo");
  assert.match(message, /never crosses a tree boundary/);
  assert.match(message, /tenancy boundary of this plane/);
});

test("THE SUBJECT GRAMMAR HAS ONE PARSER — the enterprise gate's, re-addressed to this file", () => {
  // An unknown key inside the subject is refused by artifactDocument.ts's own key check, and the
  // path the reader sees is the path in THEIR file. If this package ever forked the subject
  // parser, this test is what would notice.
  const unknown = parseOne(
    rootDeclaration({
      attributesTo: { kind: "bough", tree: "acme", bough: "payments", branch: "billing-core" },
    }),
  );
  assert.match(issueAt(unknown, "roots[0].attributesTo.branch"), /unknown field "branch"/);

  const badKind = parseOne(rootDeclaration({ attributesTo: { kind: "division", tree: "acme" } }));
  assert.match(issueAt(badKind, "roots[0].attributesTo.kind"), /none of them outranks another/);

  const scored = parseOne(
    rootDeclaration({ attributesTo: { kind: "tree", tree: "acme", confidence: 0.9 } }),
  );
  assert.match(issueAt(scored, "roots[0].attributesTo.confidence"), /refused by name/);

  const missing = parseOne(rootDeclaration({ attributesTo: undefined }));
  assert.match(issueAt(missing, "roots[0].attributesTo"), /always belongs to somebody/);
});

// ---------------------------------------------------------------------------------------------
// Drawing: what an MCP root may and may not produce.
// ---------------------------------------------------------------------------------------------

test("a complete draw produces candidate artifacts and nothing stronger", () => {
  const draw = drawFromRoot(firstRoot(), page());
  assert.ok(draw.ok);
  assert.equal(draw.completeness, "complete");
  assert.ok(draw.completeness === "complete");
  assert.equal(draw.artifacts.length, 1);
  assertNeverProof(draw.artifacts);

  const artifact = draw.artifacts[0];
  assert.ok(artifact !== undefined);
  assert.equal(artifact.title, "Billing platform migration notes");
  assert.equal(artifact.id, "mcp:gbrain/search#note%3Abilling-migration");
  assert.equal(artifact.extractor, "mcp:gbrain/search");
  assert.deepEqual(artifact.evidence, [
    { source: "mcp:gbrain/search", ref: "note:billing-migration", observedAt: "2026-08-17T10:05:00Z" },
  ]);
  assert.equal(artifact.subject.kind, "branch");
});

test("NO OBSERVATION CAN MAKE A ROOT ASSERT A TIER — the labels are refused, the tier never moves", () => {
  const fields = [
    ...PROOF_TIERS.map((tier) => ({ label: tier, text: "yes" })),
    { label: "tier", text: "verified" },
    { label: "proof_tier", text: "verified" },
    { label: "verification", text: "complete" },
  ];
  const draw = drawFromRoot(
    firstRoot(),
    page({ observations: [observation("note:1", "A note", fields)] }),
  );
  assert.ok(draw.ok);
  assert.ok(draw.completeness === "complete");
  assert.equal(draw.withheldFields.length, fields.length);
  for (const withheld of draw.withheldFields) {
    assert.match(withheld.reason, /refused by name/);
    // The text travels WITH the refusal: a refusal nobody can see is a deletion.
    assert.ok(withheld.text.length > 0);
  }
  assert.deepEqual(draw.observedFields, []);
  assertNeverProof(draw.artifacts);
});

test("EVERY score-shaped field label is withheld, and none of them reaches the document", () => {
  const fields = [...SCORE_SHAPED].map((label) => ({ label, text: "9 out of 10" }));
  const draw = drawFromRoot(
    firstRoot(),
    page({ observations: [observation("note:1", "A note", fields)] }),
  );
  assert.ok(draw.ok);
  assert.ok(draw.completeness === "complete");
  assert.equal(draw.withheldFields.length, SCORE_SHAPED.size);
  assert.deepEqual(draw.observedFields, []);
  assert.doesNotMatch(JSON.stringify(draw.artifacts), /9 out of 10/);
});

test("observed fields travel BESIDE the result and never inside the document", () => {
  const draw = drawFromRoot(
    firstRoot(),
    page({
      observations: [
        observation("note:1", "A note", [
          { label: "space", text: "PAY" },
          { label: "updated", text: "2026-08-01" },
        ]),
      ],
    }),
  );
  assert.ok(draw.ok);
  assert.ok(draw.completeness === "complete");
  assert.equal(draw.observedFields.length, 2);
  // The document format was not widened to hold upstream JSON, so none of it is in there.
  const serialized = JSON.stringify(draw.artifacts);
  assert.doesNotMatch(serialized, /"space"/);
  assert.doesNotMatch(serialized, /PAY/);
});

test("an item the upstream gave no title for states that fact, and is reported", () => {
  const draw = drawFromRoot(firstRoot(), page({ observations: [observation("session:9f2c")] }));
  assert.ok(draw.ok);
  assert.ok(draw.completeness === "complete");
  assert.equal(draw.artifacts[0]?.title, "session:9f2c — item returned by search with no title");
  assert.equal(draw.untitled.length, 1);
  assert.match(draw.untitled[0]?.reason ?? "", /returned no title/);
});

// ---------------------------------------------------------------------------------------------
// Partial success can never render as an honest empty result.
// ---------------------------------------------------------------------------------------------

test("an exhausted tool that returned nothing IS honestly empty", () => {
  const draw = drawFromRoot(firstRoot(), page({ observations: [] }));
  assert.ok(draw.ok);
  assert.equal(draw.completeness, "complete");
  assert.equal(drawnArtifacts(draw).length, 0);
  assert.equal(isHonestlyEmpty(draw), true);
});

test("A TIMEOUT THAT RETURNED NOTHING IS NOT EMPTY — same zero artifacts, opposite meaning", () => {
  const draw = drawFromRoot(
    firstRoot(),
    page({
      observations: [],
      interruptions: [{ cause: "timed-out", detail: "no response after 30s" }],
    }),
  );
  assert.ok(draw.ok);
  assert.equal(draw.completeness, "partial");
  assert.equal(drawnArtifacts(draw).length, 0);
  assert.equal(isHonestlyEmpty(draw), false);
  assert.ok(draw.completeness === "partial");
  assert.equal(draw.shortfall.length, 1);
  assert.equal(draw.shortfall[0]?.cause, "interrupted");
  // Never a zero: the count of what a timeout cost is unknown, and says so.
  assert.equal(draw.shortfall[0]?.count, null);
});

test("THE PARTIAL ARM HAS NO `artifacts` PROPERTY — the type is what stops the honest-empty read", () => {
  const partial = drawFromRoot(
    firstRoot(),
    page({ remainder: { kind: "more", resume: { kind: "offset", nextOffset: 20 } } }),
  );
  assert.ok(partial.ok);
  assert.equal(partial.completeness, "partial");
  // `partial.artifacts` does not compile; this asserts the same fact at run time so the property
  // survives a refactor that widens the type.
  assert.equal("artifacts" in partial, false);
  assert.equal("artifactsSoFar" in partial, true);

  const complete = drawFromRoot(firstRoot(), page());
  assert.ok(complete.ok);
  assert.equal("shortfall" in complete, false);
  assert.equal("skipped" in complete, false);
  assert.equal("resume" in complete, false);
});

test("A FULL PAGE WITH NO STATED REMAINDER IS PARTIAL — the measured gbrain case", () => {
  // gbrain 0.42.73.2's `search` returns up to `limit` rows and reports no total and no cursor.
  const draw = drawFromRoot(
    firstRoot(),
    page({
      remainder: {
        kind: "unknown",
        why: "the tool reports no total and issues no cursor",
        resume: { kind: "offset", nextOffset: 20 },
      },
    }),
  );
  assert.ok(draw.ok);
  assert.equal(draw.completeness, "partial");
  assert.ok(draw.completeness === "partial");
  assert.equal(draw.artifactsSoFar.length, 1);
  assert.equal(draw.shortfall[0]?.cause, "remainder-unknown");
  assert.deepEqual(draw.resume, { kind: "offset", nextOffset: 20 });
  assert.equal(isHonestlyEmpty(draw), false);
});

test("every resume kind survives the draw, including the honest `none`", () => {
  const resumes = [
    { kind: "cursor", cursor: "eyJvIjoyMH0" },
    { kind: "offset", nextOffset: 900 },
    { kind: "watermark", updatedSince: "2026-08-16T09:41:00Z" },
    { kind: "none", why: "the tool paginates but returns no handle for the next page" },
  ] as const;
  for (const resume of resumes) {
    const draw = drawFromRoot(firstRoot(), page({ remainder: { kind: "more", resume } }));
    assert.ok(draw.ok);
    assert.ok(draw.completeness === "partial");
    assert.deepEqual(draw.resume, resume);
    assert.equal(draw.shortfall[0]?.cause, "more-upstream");
  }
});

test("an exhausted page still reports HOW it knows it is exhausted", () => {
  const draw = drawFromRoot(firstRoot(), page());
  assert.ok(draw.ok);
  assert.ok(draw.completeness === "complete");
  // Nothing to resume from, and the complete arm carries no resume at all — the only place a
  // "there is nothing more" claim can be made is where the tool actually said so.
  assert.equal("resume" in draw, false);
});

test("BOTH causes are reported when a page times out AND leaves material upstream", () => {
  const draw = drawFromRoot(
    firstRoot(),
    page({
      observations: [observation("note:1", "One"), observation("note:2", "Two"), observation("note:1", "One again")],
      remainder: { kind: "more", resume: { kind: "cursor", cursor: "c1" } },
      interruptions: [{ cause: "upstream-error", detail: "502 from the gateway mid-page" }],
    }),
  );
  assert.ok(draw.ok);
  assert.ok(draw.completeness === "partial");
  assert.deepEqual(
    draw.shortfall.map((s) => s.cause),
    ["more-upstream", "interrupted", "observation-skipped"],
  );
  assert.equal(draw.skipped.length, 1);
  assert.equal(draw.skipped[0]?.cause, "duplicate-upstream-id");
  // The skipped cause is the only one that can be counted, and it is the only one that is.
  assert.equal(draw.shortfall[2]?.count, 1);
  assert.equal(draw.shortfall[0]?.count, null);
  assert.equal(draw.artifactsSoFar.length, 2);
});

test("A SKIP ALONE MAKES A DRAW PARTIAL, even when the tool said it was exhausted", () => {
  const draw = drawFromRoot(
    firstRoot(),
    page({ observations: [observation("note:1", "One"), observation("note:1", "One again")] }),
  );
  assert.ok(draw.ok);
  assert.equal(draw.completeness, "partial");
  assert.equal(isHonestlyEmpty(draw), false);
});

test("THE ARTIFACT ID IS DETERMINISTIC — a repeat across resumed pages is caught by the gate", () => {
  // The offset-resumption hazard, made survivable: an item deleted upstream shifts the offset and
  // the same item comes back on the next page. Within a page the duplicate is skipped; ACROSS
  // pages it is the enterprise document gate that refuses it, because the id is the same string.
  const first = drawFromRoot(firstRoot(), page());
  const second = drawFromRoot(
    firstRoot(),
    page({ observedAt: "2026-08-17T10:09:00Z", observations: [observation("note:billing-migration", "Billing platform migration notes")] }),
  );
  const a = drawnArtifacts(first);
  const b = drawnArtifacts(second);
  assert.equal(a[0]?.id, b[0]?.id);

  const combined = parseEnterpriseDocument(
    JSON.parse(JSON.stringify({ artifacts: [...a, ...b] })),
  );
  assert.ok(!combined.ok);
  assert.match(combined.issues[0]?.message ?? "", /duplicate id/);
});

// ---------------------------------------------------------------------------------------------
// Named refusals. A failure is never a zero and never a bare false.
// ---------------------------------------------------------------------------------------------

test("a page drawn through another root is refused, not resolved", () => {
  const draw = drawFromRoot(firstRoot(), page({ root: mcpRootId("atlassian-prod") }));
  assert.ok(!draw.ok);
  assert.equal(draw.cause, "root-mismatch");
});

test("a tool that is not on the allow-list is refused even though the server answered it", () => {
  const draw = drawFromRoot(firstRoot(), page({ tool: mcpToolName("takes_scorecard") }));
  assert.ok(!draw.ok);
  assert.equal(draw.cause, "tool-not-permitted");
  assert.match(draw.issues[0]?.message ?? "", /not on root "gbrain-local"'s allow-list/);
});

test("CROSS-TENANT AND SCOPE-WIDENED ARE DIFFERENT CAUSES, not one refusal", () => {
  const crossTenant = drawFromRoot(
    firstRoot(),
    page({ attributesTo: branchOf(BILLING, PAYMENTS, OTHER) }),
  );
  assert.ok(!crossTenant.ok);
  assert.equal(crossTenant.cause, "cross-tenant");
  assert.match(crossTenant.issues[0]?.message ?? "", /never crosses a tree boundary/);

  const widened = drawFromRoot(firstRoot(), page({ attributesTo: treeOf() }));
  assert.ok(!widened.ok);
  assert.equal(widened.cause, "scope-widened");
  assert.match(widened.issues[0]?.message ?? "", /may never widen it/);
});

test("a page MAY narrow a root's subject — a bough root drawing to a branch inside it", () => {
  const root = firstRoot(rootDeclaration({ attributesTo: { kind: "bough", tree: "acme", bough: "payments" } }));

  const narrowed = drawFromRoot(root, page({ attributesTo: branchOf() }));
  assert.ok(narrowed.ok);
  assert.deepEqual(drawnArtifacts(narrowed)[0]?.subject, branchOf());

  const toPerson = drawFromRoot(root, page({ attributesTo: personOf("a-person") }));
  assert.ok(toPerson.ok);
  assert.equal(drawnArtifacts(toPerson)[0]?.subject.kind, "leaf");
  assertNeverProof(drawnArtifacts(toPerson));

  const outsideBough = drawFromRoot(
    root,
    page({ attributesTo: boughOf(boughId("platform")) }),
  );
  assert.ok(!outsideBough.ok);
  assert.equal(outsideBough.cause, "scope-widened");
});

test("an observation with no upstream handle fails the WHOLE draw, never a partial one", () => {
  const draw = drawFromRoot(
    firstRoot(),
    page({ observations: [observation("note:1", "One"), observation("   ", "Two")] }),
  );
  assert.ok(!draw.ok);
  assert.equal(draw.cause, "unusable-observations");
  assert.match(draw.issues[0]?.at ?? "", /observations\[1\]\.upstreamId/);
});

test("an unlabelled field and a local-time observedAt are both unusable observations", () => {
  const unlabelled = drawFromRoot(
    firstRoot(),
    page({ observations: [observation("note:1", "One", [{ label: " ", text: "PAY" }])] }),
  );
  assert.ok(!unlabelled.ok);
  assert.equal(unlabelled.cause, "unusable-observations");
  assert.match(unlabelled.issues[0]?.message ?? "", /cannot be refused by name/);

  const localTime = drawFromRoot(firstRoot(), page({ observedAt: "2026-08-17 10:05" }));
  assert.ok(!localTime.ok);
  assert.equal(localTime.cause, "unusable-observations");
  assert.match(localTime.issues[0]?.at ?? "", /observedAt/);
});

test("the draw round-trips through the REAL enterprise gate, so its output is the gate's", () => {
  // Not this module's opinion of what it built: parse the drawn artifacts again from JSON and
  // check the gate accepts exactly them, including its own review-gate door.
  const draw = drawFromRoot(
    firstRoot(),
    page({
      observations: [observation("note:1", "One"), observation("note:2", "Two")],
    }),
  );
  const artifacts = drawnArtifacts(draw);
  const reparsed = parseEnterpriseDocument(JSON.parse(JSON.stringify({ artifacts })));
  assert.ok(reparsed.ok);
  assert.deepEqual(reparsed.document.artifacts, artifacts);
  assertNeverProof(reparsed.document.artifacts);
});

test("the id constructors are the only way to mint these ids, and they do not cross", () => {
  // Branded ids erase at run time, so this pins the shape rather than the brand: what is being
  // checked is that the constructors are exported and total, which is what lets a caller build a
  // page without reaching into this module's internals.
  assert.equal(mcpRootId("gbrain-local"), "gbrain-local");
  assert.equal(mcpServerId("gbrain"), "gbrain");
  assert.equal(mcpToolName("search"), "search");
});
