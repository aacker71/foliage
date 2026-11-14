/**
 * The dashboard answers a harvest that did not load with the status the leaf app gives a record in
 * the same state: a first run is a 200, a file the owner has to repair is a 409, and no cause is
 * a 500 (that stays for this app's own faults).
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { httpStatusFor } from "@foliage/leaf-app/leafDocument";

import { httpStatusForHarvest, type HarvestLoad } from "./harvestStatus.ts";

test("a harvest that did not load gets the leaf route's status for the same cause", () => {
  const path = "/synthetic/garden/harvest.json";
  const failed: readonly Extract<HarvestLoad, { ok: false }>[] = [
    { ok: false, cause: "unconfigured", detail: "unset", path: null },
    { ok: false, cause: "absent", detail: "no file", path },
    { ok: false, cause: "unreadable", detail: "EACCES", path, errno: "EACCES" },
    { ok: false, cause: "malformed", detail: "not JSON", path },
    { ok: false, cause: "invalid", detail: "not a harvest", path, issues: [] },
  ];
  assert.deepEqual(failed.map((load) => [load.cause, httpStatusForHarvest(load)]), [
    ["unconfigured", 200], ["absent", 200], ["unreadable", 409], ["malformed", 409], ["invalid", 409],
  ]);
  for (const load of failed) {
    const leaf = load.cause === "invalid" ? { ...load, issues: [] } : load;
    assert.equal(httpStatusForHarvest(load), httpStatusFor(leaf), `${load.cause}: the two documents answer alike`);
  }
});
