import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

// Query to get all import batches
export const getBatches = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 10;
    return await ctx.db.query("importBatches")
      .order("desc")
      .take(limit);
  },
});

// Query to get a single batch by ID
export const getBatchById = query({
  args: { id: v.id("importBatches") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

// Mutation to create a new import batch
export const createBatch = mutation({
  args: {
    sourceName: v.string(),
    rowsRead: v.number(),
    inserted: v.number(),
    updated: v.number(),
    skipped: v.number(),
    geocoded: v.number(),
    approximate: v.number(),
    failedGeocodes: v.number(),
    importedByUserId: v.optional(v.id("appUsers")),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("importBatches", {
      ...args,
      importedAt: Date.now(),
    });
    return id;
  },
});

// Mutation to update batch statistics
export const updateBatchStats = mutation({
  args: {
    batchId: v.id("importBatches"),
    inserted: v.optional(v.number()),
    updated: v.optional(v.number()),
    skipped: v.optional(v.number()),
    geocoded: v.optional(v.number()),
    approximate: v.optional(v.number()),
    failedGeocodes: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const updateData: Record<string, number> = {};
    if (args.inserted !== undefined) updateData.inserted = args.inserted;
    if (args.updated !== undefined) updateData.updated = args.updated;
    if (args.skipped !== undefined) updateData.skipped = args.skipped;
    if (args.geocoded !== undefined) updateData.geocoded = args.geocoded;
    if (args.approximate !== undefined) updateData.approximate = args.approximate;
    if (args.failedGeocodes !== undefined) updateData.failedGeocodes = args.failedGeocodes;
    
    await ctx.db.patch(args.batchId, updateData);
    return await ctx.db.get(args.batchId);
  },
});
