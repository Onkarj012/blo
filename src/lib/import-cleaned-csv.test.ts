import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createDatabase } from "@/lib/db";
import { importCleanedCsv } from "@/lib/import-cleaned-csv";

function makeTempDbPath(name: string): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "blo-photo-"));
  return path.join(directory, `${name}.sqlite`);
}

test("imports cleaned csv rows and upserts repeated epic numbers", async () => {
  const db = createDatabase(makeTempDbPath("import"));
  const csv = [
    "name,phone_number,address,age,gender,relative_name,relative_type,epic_number,assembly_constituency,district",
    "Asha,+91-9000000001,Roseland Residency Pimple Saudagar,40,Female,Rahul,Husband,ABC1234567,Chinchwad,Pune",
    "Rohan,+91-9000000002,Alcove Pimple Saudagar,33,Male,Suresh,Father,XYZ7654321,Chinchwad,Pune",
  ].join("\n");

  const first = await importCleanedCsv({
    content: csv,
    sourceName: "batch-1.csv",
    db,
    geocode: async ({ query }) => ({
      lat: query.includes("Roseland") ? 18.59 : 18.6,
      lng: 73.79,
      geocode_status: "approximate",
      geocode_confidence: 0.52,
      provider: "mock",
    }),
  });

  assert.equal(first.rowsRead, 2);
  assert.equal(first.inserted, 2);
  assert.equal(first.updated, 0);

  const second = await importCleanedCsv({
    content: [
      "name,phone_number,address,age,gender,relative_name,relative_type,epic_number,assembly_constituency,district",
      "Asha Updated,+91-9000000011,Roseland Residency Pimple Saudagar,41,Female,Rahul,Husband,ABC1234567,Chinchwad,Pune",
    ].join("\n"),
    sourceName: "batch-2.csv",
    db,
    geocode: async () => ({
      lat: 18.59,
      lng: 73.79,
      geocode_status: "approximate",
      geocode_confidence: 0.52,
      provider: "mock",
    }),
  });

  assert.equal(second.inserted, 0);
  assert.equal(second.updated, 1);

  const rows = db.prepare("SELECT name, phone_number, status FROM voters ORDER BY epic_number").all() as Array<{
    name: string;
    phone_number: string;
    status: string;
  }>;
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {
    name: "Asha Updated",
    phone_number: "+91-9000000011",
    status: "pending",
  });
});
