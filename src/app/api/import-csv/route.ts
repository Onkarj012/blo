import { NextRequest, NextResponse } from "next/server";
import { parse } from "csv-parse/sync";
import { convexClient } from "@/lib/convex-server";
import { requireAdmin, AuthenticatedRequest } from "@/lib/middleware";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";
import {
  buildDisplayAddress,
  detectAreaCluster,
  determineAddressQuality,
  buildRowFingerprint,
  buildSearchText,
  calculateGeocodeConfidence,
  cleanText,
} from "@/lib/normalize";
import { geocodeQuery } from "@/lib/geocode";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Cookie",
  "Access-Control-Allow-Credentials": "true",
};

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
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

const REQUIRED_HEADERS = [
  "name",
  "address",
  "age",
  "gender",
  "relative_name",
  "relative_type",
  "epic_number",
  "assembly_constituency",
  "district",
];

const BATCH_SIZE = 250;

function addCorsHeaders(response: NextResponse): NextResponse {
  Object.entries(corsHeaders).forEach(([key, value]) => {
    response.headers.set(key, value);
  });
  return response;
}

export const POST = requireAdmin(async (request: AuthenticatedRequest) => {
  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return addCorsHeaders(
        NextResponse.json({ error: "CSV file is required." }, { status: 400 })
      );
    }

    const content = await file.text();
    const userId = request.user!.userId as Id<"appUsers">;

    // Parse CSV
    const records = parse(content, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    }) as CsvRow[];

    if (records.length === 0) {
      return addCorsHeaders(
        NextResponse.json({ error: "CSV file is empty." }, { status: 400 })
      );
    }

    // Validate headers
    const headers = Object.keys(records[0]);
    const missingHeaders = REQUIRED_HEADERS.filter(h => !headers.includes(h));
    if (missingHeaders.length > 0) {
      return addCorsHeaders(
        NextResponse.json(
          { error: `Missing required columns: ${missingHeaders.join(", ")}` },
          { status: 400 }
        )
      );
    }

    // Create import batch
    const batchId = await convexClient.mutation(api.import.createBatch, {
      sourceName: file.name || "upload.csv",
      rowsRead: records.length,
      inserted: 0,
      updated: 0,
      skipped: 0,
      geocoded: 0,
      approximate: 0,
      failedGeocodes: 0,
      importedByUserId: userId,
    });

    // Process rows in batches
    let totalInserted = 0;
    let totalUpdated = 0;
    let totalSkipped = 0;
    let totalGeocoded = 0;
    let totalApproximate = 0;
    let totalFailedGeocodes = 0;

    // Geocode cache
    const geocodeCache = new Map<string, { lat: number; lng: number; status: "resolved" | "approximate" | "failed" }>();

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
          const geocodeResult = await geocodeQuery({ query: geocodeQueryStr });
          if (geocodeResult.lat && geocodeResult.lng) {
            lat = geocodeResult.lat;
            lng = geocodeResult.lng;
            geocodeStatus = geocodeResult.geocode_status;
            geocodeCache.set(geocodeQueryStr, { lat, lng, status: geocodeStatus });
          } else {
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
        const result = await convexClient.mutation(api.voters.batchUpsertVoters, {
          voters: votersToUpsert,
          importBatchId: batchId,
        });

        totalInserted += result.inserted;
        totalUpdated += result.updated;
        totalSkipped += result.skipped;
      }
    }

    // Update batch with final stats
    await convexClient.mutation(api.import.updateBatchStats, {
      batchId,
      inserted: totalInserted,
      updated: totalUpdated,
      skipped: totalSkipped,
      geocoded: totalGeocoded,
      approximate: totalApproximate,
      failedGeocodes: totalFailedGeocodes,
    });

    // Get updated batch
    const batch = await convexClient.query(api.import.getBatchById, { id: batchId });

    const response = NextResponse.json({
      ok: true,
      result: {
        batch,
        summary: {
          rowsRead: records.length,
          inserted: totalInserted,
          updated: totalUpdated,
          skipped: totalSkipped,
          geocoded: totalGeocoded,
          approximate: totalApproximate,
          failedGeocodes: totalFailedGeocodes,
        },
      },
    });
    
    return addCorsHeaders(response);
  } catch (error) {
    console.error("Import error:", error);
    return addCorsHeaders(
      NextResponse.json(
        { error: "Failed to import CSV" },
        { status: 500 }
      )
    );
  }
});
