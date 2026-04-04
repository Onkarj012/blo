#!/usr/bin/env tsx
/**
 * Migration script to transfer data from SQLite to Convex
 * Run: npx tsx scripts/migrate-to-convex.ts
 */

import Database from "better-sqlite3";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@convex/_generated/api";
import {
  buildDisplayAddress,
  detectAreaCluster,
  determineAddressQuality,
  buildRowFingerprint,
  buildSearchText,
  calculateGeocodeConfidence,
  cleanText,
} from "../src/lib/normalize";
import { Id } from "@convex/_generated/dataModel";

const DB_PATH = "./data/app/voters.sqlite";
const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL || process.env.CONVEX_URL;
const BATCH_SIZE = 250;

if (!CONVEX_URL) {
  console.error("Error: NEXT_PUBLIC_CONVEX_URL environment variable is not set");
  console.error("Please run 'npx convex dev' first to get your deployment URL");
  process.exit(1);
}

interface SqliteVoter {
  id: number;
  import_batch_id: number | null;
  name: string;
  phone_number: string;
  address_raw: string;
  display_address: string;
  area_cluster: string;
  age: string;
  gender: string;
  relative_name: string;
  relative_type: string;
  epic_number: string;
  assembly_constituency: string;
  district: string;
  status: "pending" | "done" | "locked" | "revisit" | "wrong_address";
  status_updated_at: string | null;
  status_note: string;
  lat: number | null;
  lng: number | null;
  geocode_status: "resolved" | "approximate" | "failed";
  geocode_confidence: number;
  created_at: string;
  updated_at: string;
}

async function migrate() {
  console.log("Connecting to SQLite database...");
  const db = new Database(DB_PATH);
  
  console.log("Connecting to Convex...");
  const convex = new ConvexHttpClient(CONVEX_URL!);
  
  // Get all voters from SQLite
  console.log("Fetching voters from SQLite...");
  const voters = db.prepare("SELECT * FROM voters").all() as SqliteVoter[];
  console.log(`Found ${voters.length} voters to migrate`);
  
  // Create import batch for migration
  console.log("Creating migration batch...");
  const batchId = await convex.mutation(api.import.createBatch, {
    sourceName: "sqlite-migration",
    rowsRead: voters.length,
    inserted: 0,
    updated: 0,
    skipped: 0,
    geocoded: 0,
    approximate: 0,
    failedGeocodes: 0,
  });
  
  let totalInserted = 0;
  let totalSkipped = 0;
  
  // Process in batches
  for (let i = 0; i < voters.length; i += BATCH_SIZE) {
    const batch = voters.slice(i, i + BATCH_SIZE);
    const votersToInsert = [];
    
    for (const voter of batch) {
      try {
        // Recalculate normalized fields to ensure consistency
        const displayAddress = buildDisplayAddress(voter.address_raw);
        const areaCluster = detectAreaCluster(voter.address_raw);
        const addressQuality = determineAddressQuality(voter.address_raw, areaCluster);
        const areaClusterSource =
          areaCluster === "Pimple Saudagar Core" ? ("fallback" as const) : ("rule" as const);
        
        const rowFingerprint = buildRowFingerprint({
          name: voter.name,
          relativeName: voter.relative_name,
          age: voter.age,
          gender: voter.gender,
          displayAddress,
          assemblyConstituency: voter.assembly_constituency,
          district: voter.district,
        });
        
        const searchText = buildSearchText({
          name: voter.name,
          phoneNumber: voter.phone_number,
          displayAddress,
          epicNumber: voter.epic_number,
          relativeName: voter.relative_name,
        });
        
        votersToInsert.push({
          epicNumber: voter.epic_number?.trim() || undefined,
          rowFingerprint,
          name: cleanText(voter.name),
          phoneNumber: voter.phone_number?.trim() || undefined,
          age: cleanText(voter.age),
          gender: cleanText(voter.gender),
          relativeName: cleanText(voter.relative_name) || undefined,
          relativeType: cleanText(voter.relative_type) || undefined,
          addressRaw: cleanText(voter.address_raw),
          displayAddress,
          areaCluster,
          areaClusterSource,
          areaClusterConfidence: areaCluster === "Pimple Saudagar Core" ? 0.42 : 0.9,
          areaClusterNeedsReview: areaCluster === "Pimple Saudagar Core",
          areaClusterReasonCode:
            areaCluster === "Pimple Saudagar Core" ? "fallback_cluster" : "rule_match",
          areaClusterSuggested: undefined,
          areaClusterLastClassifiedAt: Date.now(),
          addressQuality,
          searchText,
          assemblyConstituency: cleanText(voter.assembly_constituency),
          district: cleanText(voter.district),
          status: voter.status,
          statusNote: voter.status_note || undefined,
          statusUpdatedAt: voter.status_updated_at ? new Date(voter.status_updated_at).getTime() : undefined,
          lat: voter.lat || undefined,
          lng: voter.lng || undefined,
          geocodeStatus: voter.geocode_status,
          geocodeConfidence: calculateGeocodeConfidence(voter.geocode_status, addressQuality),
        });
      } catch (error) {
        console.error(`Error processing voter ${voter.id}:`, error);
        totalSkipped++;
      }
    }
    
    // Insert batch to Convex
    if (votersToInsert.length > 0) {
      const result = await convex.mutation(api.voters.batchUpsertVoters, {
        voters: votersToInsert,
        importBatchId: batchId,
      });
      
      totalInserted += result.inserted;
      totalSkipped += result.skipped;
    }
    
    console.log(`Migrated ${Math.min(i + BATCH_SIZE, voters.length)}/${voters.length} voters...`);
  }
  
  // Update batch stats
  await convex.mutation(api.import.updateBatchStats, {
    batchId,
    inserted: totalInserted,
    skipped: totalSkipped,
  });
  
  console.log("\n✓ Migration complete!");
  console.log(`Total voters: ${voters.length}`);
  console.log(`Inserted: ${totalInserted}`);
  console.log(`Skipped: ${totalSkipped}`);
  
  db.close();
}

migrate().catch((error) => {
  console.error("Migration failed:", error);
  process.exit(1);
});
