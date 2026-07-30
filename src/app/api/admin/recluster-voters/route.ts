import { NextResponse } from "next/server";

import { api } from "@convex/_generated/api";

import { classifyAreaClusters } from "@/lib/area-clustering";
import { convexClient } from "@/lib/convex-server";
import { geocodeQuery } from "@/lib/geocode";
import { requireAdmin, AuthenticatedRequest } from "@/lib/middleware";
import {
  buildGeocodeQuery,
  calculateGeocodeConfidence,
  determineAddressQuality,
} from "@/lib/normalize";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 250;
const HIGH_CONFIDENCE_THRESHOLD = 0.8;
const CLASSIFIED_CLUSTER_BATCH_SIZE = 20;

type GeocodeCacheValue = {
  lat?: number;
  lng?: number;
  geocodeStatus: "resolved" | "approximate" | "failed";
};

export const POST = requireAdmin(async (request: AuthenticatedRequest) => {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      cursor?: number;
      limit?: number;
      dryRun?: boolean;
      useExistingClusters?: boolean;
      rerunStartedAt?: number;
    };

    const cursor = Math.max(0, Number(body.cursor ?? 0));
    const limit = Math.max(1, Math.min(Number(body.limit ?? DEFAULT_LIMIT), MAX_LIMIT));
    const dryRun = body.dryRun === true;
    const useExistingClusters = body.useExistingClusters !== false;
    const rerunStartedAt =
      !useExistingClusters && cursor === 0
        ? Math.max(1, Number(body.rerunStartedAt ?? Date.now()))
        : body.rerunStartedAt !== undefined
          ? Math.max(1, Number(body.rerunStartedAt))
          : undefined;

    if (!useExistingClusters && cursor > 0 && rerunStartedAt === undefined) {
      return NextResponse.json(
        {
          error:
            "rerunStartedAt is required for cursor > 0 when useExistingClusters is false.",
        },
        { status: 400 }
      );
    }

    const existingClusters = await convexClient.query(api.clusters.getAreaClusters, {
      classifiedAfter: useExistingClusters ? undefined : rerunStartedAt,
    });
    const clusterCatalog = new Set(existingClusters);

    const page = await convexClient.query(api.voters.getVotersForRecluster, {
      cursor,
      limit,
    });

    const classifications = [];
    let totalLlmRows = 0;
    let attemptedOpenRouter = false;
    let usedOpenRouter = false;
    let model: string | null = null;
    let modelSource: "env" | "default" | null = null;

    for (let start = 0; start < page.items.length; start += CLASSIFIED_CLUSTER_BATCH_SIZE) {
      const slice = page.items.slice(start, start + CLASSIFIED_CLUSTER_BATCH_SIZE);
      const { results: sliceResults, metadata } = await classifyAreaClusters(
        slice.map((item, index) => ({
          rowIndex: start + index,
          addressRaw: item.addressRaw,
          displayAddress: item.displayAddress,
          currentAreaCluster: useExistingClusters ? item.areaCluster : undefined,
          uniqueKey: String(item._id),
        })),
        {
          existingClusters: Array.from(clusterCatalog),
          forceLlmForActionableRows: true,
        }
      );

      totalLlmRows += metadata.llmRows;
      attemptedOpenRouter = attemptedOpenRouter || metadata.attemptedOpenRouter;
      usedOpenRouter = usedOpenRouter || metadata.usedOpenRouter;
      model = model ?? metadata.model;
      modelSource = modelSource ?? metadata.modelSource;
      classifications.push(...sliceResults);

      for (const classification of sliceResults) {
        if (
          classification.areaCluster &&
          !classification.areaCluster.startsWith("Uncertain:") &&
          classification.reasonCode !== "low_information_address"
        ) {
          clusterCatalog.add(classification.areaCluster);
        }
      }
    }

    const geocodeCache = new Map<string, GeocodeCacheValue>();
    const updates = [];
    let changed = 0;
    let reviewFlagged = 0;

    for (let index = 0; index < page.items.length; index++) {
      const voter = page.items[index];
      // Skip manually-corrected voters — their area is authoritative
      if ((voter as { areaClusterSource?: string }).areaClusterSource === "manual") continue;
      const classification = classifications[index];
      const shouldApplyClassification =
        classification.reasonCode === "matched_existing_cluster" ||
        classification.reasonCode === "low_information_address" ||
        classification.source !== "llm" ||
        classification.confidence >= HIGH_CONFIDENCE_THRESHOLD;
      const useSuggestedCluster =
        shouldApplyClassification && classification.areaCluster !== voter.areaCluster;
      const finalAreaCluster = shouldApplyClassification
        ? classification.areaCluster
        : voter.areaCluster;
      const suggestedAreaCluster =
        shouldApplyClassification || classification.areaCluster === voter.areaCluster
          ? undefined
          : classification.suggestedAreaCluster ?? classification.areaCluster;

      if (classification.needsReview) {
        reviewFlagged++;
      }
      if (
        finalAreaCluster !== voter.areaCluster ||
        voter.areaClusterSource !== classification.source ||
        voter.areaClusterNeedsReview !== classification.needsReview ||
        voter.areaClusterSuggested !== suggestedAreaCluster ||
        voter.areaClusterReasonCode !== classification.reasonCode
      ) {
        changed++;
      }

      const addressQuality = determineAddressQuality(voter.addressRaw, finalAreaCluster);
      let lat = voter.lat ?? undefined;
      let lng = voter.lng ?? undefined;
      let geocodeStatus = voter.geocodeStatus;

      if (finalAreaCluster !== voter.areaCluster || geocodeStatus === "failed") {
        const geocodeKey = buildGeocodeQuery(finalAreaCluster);
        const cached = geocodeCache.get(geocodeKey);
        if (cached) {
          lat = cached.lat;
          lng = cached.lng;
          geocodeStatus = cached.geocodeStatus;
        } else {
          const geocoded = await geocodeQuery({ query: geocodeKey });
          lat = geocoded.lat ?? undefined;
          lng = geocoded.lng ?? undefined;
          geocodeStatus = geocoded.geocode_status;
          geocodeCache.set(geocodeKey, {
            lat,
            lng,
            geocodeStatus,
          });
        }
      }

      updates.push({
        voterId: voter._id,
        areaCluster: finalAreaCluster,
        areaClusterSource: (
          useSuggestedCluster && classification.source === "llm"
            ? "llm"
            : finalAreaCluster === "Pimple Saudagar Core"
              ? "fallback"
              : voter.areaCluster === finalAreaCluster
                ? (voter.areaClusterSource === "manual" ? "rule" : voter.areaClusterSource ?? "rule")
                : classification.source
        ) as "rule" | "llm" | "fallback",
        areaClusterConfidence: classification.confidence,
        areaClusterNeedsReview: classification.needsReview,
        areaClusterReasonCode: classification.reasonCode,
        areaClusterSuggested: suggestedAreaCluster,
        areaClusterLastClassifiedAt: Date.now(),
        addressQuality,
        lat,
        lng,
        geocodeStatus,
        geocodeConfidence: calculateGeocodeConfidence(geocodeStatus, addressQuality),
      });

      if (
        shouldApplyClassification &&
        finalAreaCluster &&
        !finalAreaCluster.startsWith("Uncertain:")
      ) {
        clusterCatalog.add(finalAreaCluster);
      }
    }

    let updated = 0;
    if (!dryRun && updates.length > 0) {
      const result = await convexClient.mutation(api.voters.updateAreaClusterMetadataBatch, {
        updates,
      });
      updated = result.updated;
    }

    return NextResponse.json({
      ok: true,
      result: {
        cursor,
        nextCursor: page.nextCursor,
        total: page.total,
        processed: page.items.length,
        changed,
        updated,
        reviewFlagged,
        dryRun,
        useExistingClusters,
        rerunStartedAt,
        usedOpenRouter,
        attemptedOpenRouter,
        llmRows: totalLlmRows,
        model,
        modelSource,
      },
    });
  } catch (error) {
    console.error("Recluster voters error:", error);
    return NextResponse.json({ error: "Failed to re-cluster voters" }, { status: 500 });
  }
});
