#!/usr/bin/env tsx
/**
 * Import full voter data from CSV to Convex
 * Run: npx tsx scripts/import-full-csv.ts
 */

import { parse } from "csv-parse/sync";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { Id } from "../convex/_generated/dataModel";
import {
  buildDisplayAddress,
  detectAreaCluster,
  determineAddressQuality,
  buildRowFingerprint,
  buildSearchText,
  calculateGeocodeConfidence,
  cleanText,
} from "../src/lib/normalize";
import { geocodeQuery } from "../src/lib/geocode";
import * as fs from "fs";
import * as path from "path";

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL || process.env.CONVEX_URL;
const CSV_PATH = path.join(process.cwd(), "data/output/clean/1_1530_cleaned.csv");
const BATCH_SIZE = 250;

if (!CONVEX_URL) {
  console.error("Error: NEXT_PUBLIC_CONVEX_URL environment variable is not set");
  console.error("Please run 'npx convex dev' first to get your deployment URL");
  process.exit(1);
}

interface CsvRow {
  name?: string;
  phone_number?: string;
  address?: string;
  age?: string;
  gender?: string;
  relative_name?: string;
  relative_type?: string;
  epic_number?: string;
  assembly_constituency?: string;
  district?: string;
}

async function importCSV() {
  console.log("Reading CSV file...");
  const content = fs.readFileSync(CSV_PATH, "utf-8");
  
  console.log("Parsing CSV...");
  const records = parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as CsvRow[];

  console.log(`Found ${records.length} voters to import`);

  const convex = new ConvexHttpClient(CONVEX_URL!);
  
  // Create import batch
  console.log("Creating import batch...");
  const batchId = await convex.mutation(api.import.createBatch, {
    sourceName: "1_1530_cleaned.csv",
    rowsRead: records.length,
    inserted: 0,
    updated: 0,
    skipped: 0,
    geocoded: 0,
    approximate: 0,
    failedGeocodes: 0,
  });

  let totalInserted = 0;
  let totalUpdated = 0;
  let totalSkipped = 0;
  let totalGeocoded = 0;
  let totalApproximate = 0;
  let totalFailedGeocodes = 0;

  // Geocode cache
  const geocodeCache = new Map<string, { lat: number; lng: number; status: "resolved" | "approximate" | "failed" }>();

  console.log("Processing voters in batches...");
  
  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);
    const votersToUpsert = [];

    for (const row of batch) {
      // Skip rows with no name
      if (!row.name || row.name.trim() === "") {
        totalSkipped++;
        continue;
      }

      // Normalize data
      const displayAddress = buildDisplayAddress(row.address || "");
      const areaCluster = detectAreaCluster(row.address || "");
      const addressQuality = determineAddressQuality(row.address || "", areaCluster);

      // Geocode
      let lat: number | undefined;
      let lng: number | undefined;
      let geocodeStatus: "resolved" | "approximate" | "failed" = "failed";

      const geocodeQueryStr = `${areaCluster}, Pimple Saudagar, Pune, Maharashtra, India`;
      
      if (geocodeCache.has(geocodeQueryStr)) {
        const cached = geocodeCache.get(geocodeQueryStr)!;
        if (cached.status !== "failed") {
          lat = cached.lat;
          lng = cached.lng;
          geocodeStatus = cached.status;
        }
      } else {
        try {
          const geocodeResult = await geocodeQuery({ query: geocodeQueryStr });
          if (geocodeResult.lat && geocodeResult.lng) {
            lat = geocodeResult.lat;
            lng = geocodeResult.lng;
            geocodeStatus = geocodeResult.geocode_status;
            geocodeCache.set(geocodeQueryStr, { lat, lng, status: geocodeStatus });
          } else {
            geocodeCache.set(geocodeQueryStr, { lat: 0, lng: 0, status: "failed" });
          }
        } catch {
          geocodeCache.set(geocodeQueryStr, { lat: 0, lng: 0, status: "failed" });
        }
      }

      // Track geocode results
      if (geocodeStatus === "resolved") {
        totalGeocoded++;
      } else if (geocodeStatus === "approximate") {
        totalApproximate++;
      } else {
        totalFailedGeocodes++;
      }

      // Build fingerprint
      const rowFingerprint = buildRowFingerprint({
        name: row.name,
        relativeName: row.relative_name,
        age: row.age || "",
        gender: row.gender || "",
        displayAddress,
        assemblyConstituency: row.assembly_constituency || "",
        district: row.district || "",
      });

      // Build search text
      const searchText = buildSearchText({
        name: row.name,
        phoneNumber: row.phone_number,
        displayAddress,
        epicNumber: row.epic_number,
        relativeName: row.relative_name,
      });

      votersToUpsert.push({
        epicNumber: row.epic_number?.trim() || undefined,
        rowFingerprint,
        name: cleanText(row.name),
        phoneNumber: row.phone_number?.trim() || undefined,
        age: cleanText(row.age),
        gender: cleanText(row.gender),
        relativeName: cleanText(row.relative_name) || undefined,
        relativeType: cleanText(row.relative_type) || undefined,
        addressRaw: cleanText(row.address),
        displayAddress,
        areaCluster,
        addressQuality,
        searchText,
        assemblyConstituency: cleanText(row.assembly_constituency),
        district: cleanText(row.district),
        lat,
        lng,
        geocodeStatus,
        geocodeConfidence: calculateGeocodeConfidence(geocodeStatus, addressQuality),
      });
    }

    // Upsert batch to Convex
    if (votersToUpsert.length > 0) {
      const result = await convex.mutation(api.voters.batchUpsertVoters, {
        voters: votersToUpsert,
        importBatchId: batchId,
      });

      totalInserted += result.inserted;
      totalUpdated += result.updated;
      totalSkipped += result.skipped;
    }

    console.log(`Progress: ${Math.min(i + BATCH_SIZE, records.length)}/${records.length} voters processed`);
  }

  // Update batch with final stats
  await convex.mutation(api.import.updateBatchStats, {
    batchId,
    inserted: totalInserted,
    updated: totalUpdated,
    skipped: totalSkipped,
    geocoded: totalGeocoded,
    approximate: totalApproximate,
    failedGeocodes: totalFailedGeocodes,
  });

  console.log("\n✓ Import complete!");
  console.log(`Total voters: ${records.length}`);
  console.log(`Inserted: ${totalInserted}`);
  console.log(`Updated: ${totalUpdated}`);
  console.log(`Skipped: ${totalSkipped}`);
  console.log(`Geocoded: ${totalGeocoded}`);
  console.log(`Approximate: ${totalApproximate}`);
  console.log(`Failed geocodes: ${totalFailedGeocodes}`);
}

importCSV().catch((error) => {
  console.error("Import failed:", error);
  process.exit(1);
});
