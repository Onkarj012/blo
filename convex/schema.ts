import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // Voters table - main voter records
  voters: defineTable({
    // Identity fields
    epicNumber: v.optional(v.string()),
    rowFingerprint: v.string(),
    
    // Personal info
    name: v.string(),
    phoneNumber: v.optional(v.string()),
    age: v.string(),
    gender: v.string(),
    relativeName: v.optional(v.string()),
    relativeType: v.optional(v.string()),
    
    // Address info
    addressRaw: v.string(),
    displayAddress: v.string(),
    areaCluster: v.string(),
    // Widened for migration: old voter docs won't have these until re-cluster backfill runs.
    areaClusterSource: v.optional(v.union(
      v.literal("rule"),
      v.literal("llm"),
      v.literal("fallback"),
      v.literal("manual")
    )),
    areaClusterConfidence: v.optional(v.number()),
    areaClusterNeedsReview: v.optional(v.boolean()),
    areaClusterReasonCode: v.optional(v.string()),
    areaClusterSuggested: v.optional(v.string()),
    areaClusterLastClassifiedAt: v.optional(v.number()),
    addressQuality: v.union(
      v.literal("actionable"),
      v.literal("vague"),
      v.literal("missing")
    ),
    searchText: v.string(),
    
    // Administrative
    assemblyConstituency: v.string(),
    district: v.string(),
    
    // Status
    status: v.union(
      v.literal("pending"),
      v.literal("done"),
      v.literal("locked"),
      v.literal("revisit"),
      v.literal("wrong_address")
    ),
    statusNote: v.optional(v.string()),
    statusUpdatedAt: v.optional(v.number()),
    updatedByUserId: v.optional(v.id("appUsers")),
    visited: v.optional(v.boolean()),
    visitedAt: v.optional(v.number()),
    visitedByUserId: v.optional(v.id("appUsers")),
    
    // Geolocation
    lat: v.optional(v.number()),
    lng: v.optional(v.number()),
    geocodeStatus: v.union(
      v.literal("resolved"),
      v.literal("approximate"),
      v.literal("failed")
    ),
    geocodeConfidence: v.number(),
    
    // Import tracking
    latestImportBatchId: v.optional(v.id("importBatches")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_epicNumber", ["epicNumber"])
    .index("by_rowFingerprint", ["rowFingerprint"])
    .index("by_status", ["status"])
    .index("by_areaCluster", ["areaCluster"])
    .index("by_status_and_areaCluster", ["status", "areaCluster"])
    .index("by_addressQuality_and_status", ["addressQuality", "status"])
    .index("by_visited", ["visited"])
    .index("by_searchText", ["searchText"])
    .searchIndex("search_voters", {
      searchField: "searchText",
      filterFields: ["status", "areaCluster", "addressQuality"],
    }),

  // Import batches tracking
  importBatches: defineTable({
    sourceName: v.string(),
    rowsRead: v.number(),
    inserted: v.number(),
    updated: v.number(),
    skipped: v.number(),
    geocoded: v.number(),
    approximate: v.number(),
    failedGeocodes: v.number(),
    importedByUserId: v.optional(v.id("appUsers")),
    importedAt: v.number(),
  }),

  // Status change audit log
  statusEvents: defineTable({
    voterId: v.id("voters"),
    fromStatus: v.string(),
    toStatus: v.string(),
    note: v.optional(v.string()),
    changedByUserId: v.optional(v.id("appUsers")),
    changedAt: v.number(),
  })
    .index("by_voterId", ["voterId"])
    .index("by_voterId_and_changedAt", ["voterId", "changedAt"]),

  // Application users for authentication
  appUsers: defineTable({
    username: v.string(),
    displayName: v.string(),
    passwordHash: v.string(),
    role: v.union(v.literal("admin"), v.literal("user")),
    isActive: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_username", ["username"]),
});
