import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createDatabase,
  createImportBatch,
  finalizeImportBatch,
  listNearbyVoters,
  replaceTodayQueue,
  upsertVoter,
} from "@/lib/db";

function makeTempDbPath(name: string): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "blo-photo-nearby-"));
  return path.join(directory, `${name}.sqlite`);
}

test("listNearbyVoters sorts geocoded results first and keeps queue flags", () => {
  const db = createDatabase(makeTempDbPath("nearby"));
  const batchId = createImportBatch("seed.csv", new Date().toISOString(), db);
  finalizeImportBatch(batchId, 2, db);

  upsertVoter(
    {
      import_batch_id: batchId,
      name: "Near voter",
      phone_number: "",
      address_raw: "Roseland Residency",
      display_address: "Roseland Residency",
      area_cluster: "Roseland Residency",
      age: "",
      gender: "",
      relative_name: "",
      relative_type: "",
      epic_number: "AAA1111111",
      assembly_constituency: "Chinchwad",
      district: "Pune",
      lat: 18.59,
      lng: 73.79,
      geocode_status: "approximate",
      geocode_confidence: 0.5,
      importedAt: new Date().toISOString(),
    },
    db
  );

  upsertVoter(
    {
      import_batch_id: batchId,
      name: "Fallback voter",
      phone_number: "",
      address_raw: "Unknown",
      display_address: "Unknown",
      area_cluster: "Pimple Saudagar Core",
      age: "",
      gender: "",
      relative_name: "",
      relative_type: "",
      epic_number: "BBB2222222",
      assembly_constituency: "Chinchwad",
      district: "Pune",
      lat: null,
      lng: null,
      geocode_status: "failed",
      geocode_confidence: 0,
      importedAt: new Date().toISOString(),
    },
    db
  );

  const firstId = (db.prepare("SELECT id FROM voters WHERE epic_number = 'AAA1111111'").get() as { id: number }).id;
  replaceTodayQueue("device-1", [firstId], new Date().toISOString(), db);

  const result = listNearbyVoters(
    {
      lat: 18.5901,
      lng: 73.7901,
      statusFilter: "all",
      radiusMeters: 1500,
      limit: 20,
      deviceId: "device-1",
    },
    db
  );

  assert.equal(result.items[0]?.name, "Near voter");
  assert.equal(result.items[0]?.queue_selected, true);
  assert.equal(result.items[1]?.distance_meters, null);
});
