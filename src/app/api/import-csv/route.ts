import { NextRequest, NextResponse } from "next/server";
import { parse } from "csv-parse/sync";
import { convexClient } from "@/lib/convex-server";
import { requireAdmin, AuthenticatedRequest } from "@/lib/middleware";
import { api } from "@convex/_generated/api";
import { Id } from "@convex/_generated/dataModel";
import { classifyAreaClusters } from "@/lib/area-clustering";
import {
  buildDisplayAddress,
  buildGeocodeQuery,
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
  ecinet_name?: string;
  ecinet_relative_name?: string;
  ecinet_part_sr_no?: string;
  part_no?: string;
  part_number?: string;
  part_serial_no?: string;
  phone_number?: string;
  address?: string;
  age?: string;
  gender?: string;
  relative_name?: string;
  relative_type?: string;
  epic_number?: string;
  assembly_constituency?: string;
  district?: string;
  status?: string;
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
const CLASSIFIED_CLUSTER_BATCH_SIZE = 40;
type ImportStatus = "pending" | "done" | "locked" | "revisit" | "wrong_address";

const VALID_IMPORT_STATUSES: ReadonlySet<ImportStatus> = new Set([
  "pending",
  "done",
  "locked",
  "revisit",
  "wrong_address",
]);

function parseImportStatus(value?: string): ImportStatus | undefined {
  return value && VALID_IMPORT_STATUSES.has(value as ImportStatus)
    ? value as ImportStatus
    : undefined;
}

type NormalizedCsvRow = {
  source: CsvRow;
  normalizedName: string;
  displayAddress: string;
  rowFingerprint: string;
  searchText: string;
};

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
    let totalLlmRows = 0;
    let usedOpenRouter = false;
    let attemptedOpenRouter = false;
    let modelUsed: string | null = null;
    let modelSource: "env" | "default" | null = null;
    const existingClusters = await convexClient.query(api.clusters.getAreaClusters, {});
    const clusterCatalog = new Set(existingClusters);

    // Geocode cache
    const geocodeCache = new Map<string, { lat: number; lng: number; status: "resolved" | "approximate" | "failed" }>();

    for (let i = 0; i < records.length; i += BATCH_SIZE) {
      const batch = records.slice(i, i + BATCH_SIZE);
      const votersToUpsert = [];
      const normalizedRows: NormalizedCsvRow[] = [];

      for (const row of batch) {
        const sourceName = row.name?.trim() || row.ecinet_name?.trim() || "";
        // Skip rows with no name
        if (!sourceName) {
          totalSkipped++;
          continue;
        }

        const displayAddress = buildDisplayAddress(row.address || "");
        const rowFingerprint = buildRowFingerprint({
          name: sourceName,
          relativeName: row.relative_name || row.ecinet_relative_name,
          age: row.age || "",
          gender: row.gender || "",
          displayAddress,
          assemblyConstituency: row.assembly_constituency || "",
          district: row.district || "",
        });
        const searchText = buildSearchText({
          name: sourceName,
          phoneNumber: row.phone_number,
          displayAddress,
          epicNumber: row.epic_number,
          relativeName: row.relative_name,
        });

        normalizedRows.push({
          source: { ...row, name: sourceName },
          normalizedName: cleanText(sourceName),
          displayAddress,
          rowFingerprint,
          searchText,
        });
      }

      const classifications = [];
      for (let j = 0; j < normalizedRows.length; j += CLASSIFIED_CLUSTER_BATCH_SIZE) {
        const slice = normalizedRows.slice(j, j + CLASSIFIED_CLUSTER_BATCH_SIZE);
        const { results: sliceResults, metadata } = await classifyAreaClusters(
          slice.map((row, index) => ({
            rowIndex: j + index,
            addressRaw: row.source.address || "",
            displayAddress: row.displayAddress,
            uniqueKey: row.source.epic_number?.trim() || `${i + j + index}`,
          }))
          ,
          {
            existingClusters: Array.from(clusterCatalog),
            forceLlmForActionableRows: true,
          }
        );
        totalLlmRows += metadata.llmRows;
        usedOpenRouter = usedOpenRouter || metadata.usedOpenRouter;
        attemptedOpenRouter = attemptedOpenRouter || metadata.attemptedOpenRouter;
        modelUsed = modelUsed ?? metadata.model;
        modelSource = modelSource ?? metadata.modelSource;
        classifications.push(...sliceResults);
      }

      const classificationByIndex = new Map(
        classifications.map((classification) => [classification.rowIndex, classification])
      );

      for (let batchIndex = 0; batchIndex < normalizedRows.length; batchIndex++) {
        const row = normalizedRows[batchIndex];
        const source = row.source;
        const importedStatus = parseImportStatus(source.status);
        const classification = classificationByIndex.get(batchIndex);
        const areaCluster = classification?.areaCluster ?? "Pimple Saudagar Core";
        const addressQuality = determineAddressQuality(source.address || "", areaCluster);

        // Geocode
        let lat: number | undefined;
        let lng: number | undefined;
        let geocodeStatus: "resolved" | "approximate" | "failed" = "failed";

        const geocodeQueryStr = buildGeocodeQuery(areaCluster);
        
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

        votersToUpsert.push({
          epicNumber: source.epic_number?.trim() || undefined,
          rowFingerprint: row.rowFingerprint,
          name: row.normalizedName,
          phoneNumber: source.phone_number?.trim() || undefined,
          age: cleanText(source.age),
          gender: cleanText(source.gender),
          relativeName: cleanText(source.relative_name) || undefined,
          relativeType: cleanText(source.relative_type) || undefined,
          addressRaw: cleanText(source.address),
          displayAddress: row.displayAddress,
          areaCluster,
          areaClusterSource: classification?.source ?? "fallback",
          areaClusterConfidence: classification?.confidence ?? 0.42,
          areaClusterNeedsReview: classification?.needsReview ?? true,
          areaClusterReasonCode: classification?.reasonCode,
          areaClusterSuggested: classification?.suggestedAreaCluster,
          areaClusterLastClassifiedAt: Date.now(),
          addressQuality,
          searchText: row.searchText,
          ...(cleanText(source.part_no || source.part_number)
            ? {
                partNumber: cleanText(source.part_no || source.part_number),
                partSerialNumber: cleanText(source.part_serial_no || source.ecinet_part_sr_no) || undefined,
              }
            : {}),
          assemblyConstituency: cleanText(source.assembly_constituency),
          district: cleanText(source.district),
          lat,
          lng,
          geocodeStatus,
          geocodeConfidence: calculateGeocodeConfidence(geocodeStatus, addressQuality),
          ...(importedStatus ? { status: importedStatus } : {}),
        });

        if (
          !classification?.needsReview &&
          classification?.areaCluster &&
          !classification.areaCluster.startsWith("Uncertain:")
        ) {
          clusterCatalog.add(classification.areaCluster);
        }
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
          usedOpenRouter,
          attemptedOpenRouter,
          llmRows: totalLlmRows,
          model: modelUsed,
          modelSource,
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
