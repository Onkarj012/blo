import { parse } from "csv-parse/sync";
import type Database from "better-sqlite3";

import {
  createImportBatch,
  finalizeImportBatch,
  getDb,
  getGeocodeCache,
  setGeocodeCache,
  upsertVoter,
} from "@/lib/db";
import { buildDisplayAddress, buildGeocodeQuery, cleanText, detectAreaCluster } from "@/lib/address";
import { geocodeQuery, waitForPoliteGeocodeDelay } from "@/lib/geocode";
import type {
  CsvVoterRow,
  GeocodeLookup,
  ImportResult,
  StoredVoter,
} from "@/lib/types";

const REQUIRED_HEADERS = [
  "name",
  "phone_number",
  "address",
  "age",
  "gender",
  "relative_name",
  "relative_type",
  "epic_number",
  "assembly_constituency",
  "district",
];

type NormalizedRow = Omit<
  StoredVoter,
  | "id"
  | "status"
  | "status_updated_at"
  | "status_note"
  | "created_at"
  | "updated_at"
  | "import_batch_id"
  | "lat"
  | "lng"
  | "geocode_status"
  | "geocode_confidence"
> & {
  geocodeQuery: string;
  isFallbackQuery: boolean;
};

function ensureExpectedHeaders(rows: CsvVoterRow[]): void {
  if (rows.length === 0) {
    return;
  }
  const keys = new Set(Object.keys(rows[0] ?? {}));
  for (const header of REQUIRED_HEADERS) {
    if (!keys.has(header)) {
      throw new Error(`Missing required CSV header: ${header}`);
    }
  }
}

function normalizeRow(row: CsvVoterRow): NormalizedRow {
  const addressRaw = cleanText(row.address);
  const displayAddress = buildDisplayAddress(addressRaw);
  const areaCluster = detectAreaCluster(addressRaw);
  const geocodeQueryValue = buildGeocodeQuery(areaCluster);
  return {
    name: cleanText(row.name),
    phone_number: cleanText(row.phone_number),
    address_raw: addressRaw,
    display_address: displayAddress,
    area_cluster: areaCluster,
    age: cleanText(row.age),
    gender: cleanText(row.gender),
    relative_name: cleanText(row.relative_name),
    relative_type: cleanText(row.relative_type),
    epic_number: cleanText(row.epic_number).toUpperCase(),
    assembly_constituency: cleanText(row.assembly_constituency),
    district: cleanText(row.district),
    geocodeQuery: geocodeQueryValue,
    isFallbackQuery: geocodeQueryValue === "Pimple Saudagar, Pune, Maharashtra, India",
  };
}

export async function importCleanedCsv({
  content,
  sourceName,
  geocode = geocodeQuery,
  db = getDb(),
}: {
  content: string;
  sourceName: string;
  geocode?: (input: { query: string; isFallbackQuery?: boolean }) => Promise<GeocodeLookup>;
  db?: Database.Database;
}): Promise<ImportResult> {
  const importedAt = new Date().toISOString();
  const parsedRows = parse(content, {
    bom: true,
    columns: true,
    relax_quotes: true,
    skip_empty_lines: true,
    trim: true,
  }) as CsvVoterRow[];

  ensureExpectedHeaders(parsedRows);

  const normalizedRows = parsedRows.map(normalizeRow);
  const batchId = createImportBatch(sourceName, importedAt, db);
  const geocodeMap = new Map<string, GeocodeLookup>();
  let geocoded = 0;
  let approximate = 0;
  let failedGeocodes = 0;

  for (const row of normalizedRows) {
    if (geocodeMap.has(row.geocodeQuery)) {
      continue;
    }

    const cached = getGeocodeCache(row.geocodeQuery, db);
    if (cached) {
      geocodeMap.set(row.geocodeQuery, cached);
      continue;
    }

    const lookup = await geocode({
      query: row.geocodeQuery,
      isFallbackQuery: row.isFallbackQuery,
    });
    setGeocodeCache(row.geocodeQuery, lookup, importedAt, db);
    geocodeMap.set(row.geocodeQuery, lookup);
    if (lookup.provider !== "cluster-map") {
      await waitForPoliteGeocodeDelay();
    }
  }

  let inserted = 0;
  let updated = 0;

  const transaction = db.transaction(() => {
    for (const row of normalizedRows) {
      const lookup =
        geocodeMap.get(row.geocodeQuery) ??
        ({
          lat: null,
          lng: null,
          geocode_status: "failed",
          geocode_confidence: 0,
          provider: "nominatim",
        } satisfies GeocodeLookup);

      if (lookup.geocode_status === "resolved") {
        geocoded += 1;
      } else if (lookup.geocode_status === "approximate") {
        approximate += 1;
      } else {
        failedGeocodes += 1;
      }

      const action = upsertVoter(
        {
          import_batch_id: batchId,
          name: row.name,
          phone_number: row.phone_number,
          address_raw: row.address_raw,
          display_address: row.display_address,
          area_cluster: row.area_cluster,
          age: row.age,
          gender: row.gender,
          relative_name: row.relative_name,
          relative_type: row.relative_type,
          epic_number: row.epic_number,
          assembly_constituency: row.assembly_constituency,
          district: row.district,
          lat: lookup.lat,
          lng: lookup.lng,
          geocode_status: lookup.geocode_status,
          geocode_confidence: lookup.geocode_confidence,
          importedAt,
        },
        db
      );

      if (action === "inserted") {
        inserted += 1;
      } else {
        updated += 1;
      }
    }
  });

  transaction();
  finalizeImportBatch(batchId, normalizedRows.length, db);

  return {
    batchId,
    sourceName,
    rowsRead: normalizedRows.length,
    inserted,
    updated,
    geocoded,
    approximate,
    failedGeocodes,
  };
}
