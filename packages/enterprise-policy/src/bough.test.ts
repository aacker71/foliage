/**
 * The tree's interior. The cases that matter are the ones where a count could lie.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { leafId, type Leaf } from "@foliage/leaf";

import {
  boughId,
  branchId,
  companySize,
  duplicateLeaves,
  everyLimb,
  limbSize,
  pathToLeaf,
  type Bough,
  type Branch,
  type CompanyTree,
} from "./bough.ts";

const person = (id: string, subject: string): Leaf => ({ id: leafId(id), subject, leaflets: [] });

const team = (id: string, name: string, leaves: Leaf[], branches: Branch[] = []): Branch => ({
  id: branchId(id),
  name,
  branches,
  leaves,
});

const org = (id: string, name: string, branches: Branch[], leaves: Leaf[] = []): Bough => ({
  id: boughId(id),
  name,
  branches,
  leaves,
});

/** A company shaped like a real one: two orgs, nested teams, and a direct report. */
const acme: CompanyTree = {
  id: "acme",
  company: "Acme Instruments",
  boughs: [
    org(
      "platform",
      "Platform",
      [
        team("runtime", "Runtime", [person("ada", "Ada"), person("rey", "Rey")], [
          team("compiler", "Compiler", [person("kai", "Kai")]),
        ]),
        team("infra", "Infra", [person("sol", "Sol")]),
      ],
      // Someone who reports to the org, not to any team. Real, and the reason boughs
      // carry leaves at all.
      [person("mira", "Mira")],
    ),
    org("design", "Design", [team("brand", "Brand", [person("nell", "Nell")])]),
  ],
};

test("direct and total counts are never conflated", () => {
  const platform = acme.boughs[0]!;
  const size = limbSize(platform);
  // The lead's own direct reports: one person, two teams.
  assert.equal(size.directLeaves, 1);
  assert.equal(size.directBranches, 2);
  // Everyone beneath: mira + ada + rey + kai + sol.
  assert.equal(size.totalLeaves, 5);
  // Runtime, Compiler, Infra.
  assert.equal(size.totalBranches, 3);
  // Runtime → Compiler is two levels of team below the bough.
  assert.equal(size.depth, 2);
});

test("a team with no people and no sub-teams is an ordinary state, not an error", () => {
  const size = limbSize(team("new", "Newly Formed", []));
  assert.deepEqual(size, {
    directLeaves: 0,
    directBranches: 0,
    totalLeaves: 0,
    totalBranches: 0,
    depth: 0,
  });
});

test("companySize counts units and people, and produces no figure standing for them", () => {
  const size = companySize(acme);
  assert.equal(size.boughs, 2);
  assert.equal(size.branches, 4); // Runtime, Compiler, Infra, Brand
  assert.equal(size.leaves, 6); // mira ada rey kai sol nell
  assert.equal(size.depth, 3); // bough → team → sub-team
  // The shape is the guarantee: counts only. Anything ratio-shaped would have to be
  // computed by a caller who then owns that choice.
  assert.deepEqual(Object.keys(size).sort(), ["boughs", "branches", "depth", "leaves"]);
});

test("pathToLeaf gives the org path, and distinguishes absent from top-level", () => {
  const path = pathToLeaf(acme, leafId("kai"));
  assert.deepEqual(path?.map((l) => l.name), ["Platform", "Runtime", "Compiler"]);

  // A person attached to the bough itself stops there.
  assert.deepEqual(pathToLeaf(acme, leafId("mira"))?.map((l) => l.name), ["Platform"]);

  // Not in this company at all is null — a different fact from "attached to the trunk".
  assert.equal(pathToLeaf(acme, leafId("nobody")), null);
});

test("everyLimb visits every bough and branch exactly once", () => {
  const names = everyLimb(acme).map((l) => l.name);
  assert.deepEqual(names, ["Platform", "Runtime", "Compiler", "Infra", "Design", "Brand"]);
  assert.equal(new Set(names).size, names.length);
});

test("a person appearing under two limbs is REPORTED, never silently resolved", () => {
  const doubled: CompanyTree = {
    ...acme,
    boughs: [acme.boughs[0]!, org("design", "Design", [team("brand", "Brand", [person("ada", "Ada")])])],
  };
  assert.deepEqual(duplicateLeaves(doubled), [leafId("ada")]);
  // The healthy tree has none — so the check means something when it fires.
  assert.deepEqual(duplicateLeaves(acme), []);
});
