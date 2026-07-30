import assert from "node:assert/strict";
import test from "node:test";

import { buildClusterAuditRows } from "@/lib/cluster-audit";

test("cluster audit marks known actionable society rows as ready", () => {
  const [row] = buildClusterAuditRows([
    {
      name: "Sanket Jadhav",
      address: "Flat 204 Roseland Residency Pimple Saudagar",
      epic_number: "YQA6227318",
      merge_match_confidence: "epic",
    },
  ]);

  assert.equal(row.route_cluster, "Roseland Residency");
  assert.equal(row.cluster_review_status, "ready");
  assert.equal(row.address_quality, "actionable");
  assert.equal(row.identity_match_confidence, "epic");
});

test("cluster audit keeps unit-only addresses out of ready route groups", () => {
  const [row] = buildClusterAuditRows([
    {
      name: "Unknown Voter",
      address: "501",
      epic_number: "YQA0000000",
      merge_match_confidence: "epic",
    },
  ]);

  assert.equal(row.cluster_review_status, "manual_lookup");
  assert.match(row.route_cluster, /^Uncertain:|Pimple Saudagar Core|501/);
  assert.match(row.cluster_notes, /low_information_address|unit_or_number_only_address/);
});

test("cluster audit includes cluster sizes after sorting by route cluster", () => {
  const rows = buildClusterAuditRows([
    { name: "A", address: "Deepmala Pimple Saudagar", merge_match_confidence: "epic" },
    { name: "B", address: "Deepmala Pimple Saudagar", merge_match_confidence: "epic" },
    { name: "C", address: "Muktangan Niwas Pimple Saudagar", merge_match_confidence: "epic" },
  ]);

  const deepmalaRows = rows.filter((row) => row.route_cluster === "Deepmala");
  assert.equal(deepmalaRows.length, 2);
  assert.deepEqual(
    deepmalaRows.map((row) => row.cluster_size),
    ["2", "2"]
  );
});
