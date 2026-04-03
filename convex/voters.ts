import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

// Query to get voters with comprehensive filtering
export const getVoters = query({
  args: {
    status: v.optional(v.union(
      v.literal("pending"),
      v.literal("done"),
      v.literal("locked"),
      v.literal("revisit"),
      v.literal("wrong_address")
    )),
    visited: v.optional(v.union(
      v.literal("all"),
      v.literal("visited"),
      v.literal("unvisited")
    )),
    name: v.optional(v.string()),
    phone: v.optional(v.string()),
    address: v.optional(v.string()),
    gender: v.optional(v.string()),
    minAge: v.optional(v.number()),
    maxAge: v.optional(v.number()),
    areaCluster: v.optional(v.string()),
    phoneOnly: v.optional(v.boolean()),
    includeVague: v.optional(v.boolean()),
    includeMissing: v.optional(v.boolean()),
    lat: v.optional(v.number()),
    lng: v.optional(v.number()),
    radius: v.optional(v.number()),
    limit: v.optional(v.number()),
    cursor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;
    
    // Get all voters first
    let allVoters = await ctx.db.query("voters").collect();
    
    // Apply filters
    if (args.status) {
      allVoters = allVoters.filter(v => v.status === args.status);
    }
    
    // Apply visited filter
    if (args.visited && args.visited !== "all") {
      allVoters = allVoters.filter(v => {
        const isVisited = v.visited ?? false;
        return args.visited === "visited" ? isVisited : !isVisited;
      });
    }
    
    // Apply address quality filter
    if (!args.includeVague && !args.includeMissing) {
      allVoters = allVoters.filter(v => v.addressQuality === "actionable");
    }
    
    // Apply name filter
    if (args.name) {
      const nameQuery = args.name.toLowerCase();
      allVoters = allVoters.filter(v => 
        v.name.toLowerCase().includes(nameQuery)
      );
    }
    
    // Apply phone filter
    if (args.phone) {
      allVoters = allVoters.filter(v => 
        v.phoneNumber?.includes(args.phone!)
      );
    }
    
    // Apply address filter
    if (args.address) {
      const addrQuery = args.address.toLowerCase();
      allVoters = allVoters.filter(v => 
        v.displayAddress.toLowerCase().includes(addrQuery) ||
        v.areaCluster.toLowerCase().includes(addrQuery)
      );
    }
    
    // Apply gender filter
    if (args.gender) {
      allVoters = allVoters.filter(v => 
        v.gender.toLowerCase() === args.gender!.toLowerCase()
      );
    }
    
    // Apply age filters
    if (args.minAge !== undefined) {
      allVoters = allVoters.filter(v => parseInt(v.age) >= args.minAge!);
    }
    if (args.maxAge !== undefined) {
      allVoters = allVoters.filter(v => parseInt(v.age) <= args.maxAge!);
    }
    
    // Apply area cluster filter
    if (args.areaCluster) {
      allVoters = allVoters.filter(v => v.areaCluster === args.areaCluster);
    }
    
    // Apply phone availability filter
    if (args.phoneOnly) {
      allVoters = allVoters.filter(v => v.phoneNumber && v.phoneNumber.trim() !== "");
    }
    
    // Apply radius filter if location provided
    if (args.lat && args.lng && args.radius) {
      allVoters = allVoters.filter(v => {
        if (!v.lat || !v.lng) return false;
        const distance = calculateDistance(args.lat!, args.lng!, v.lat, v.lng);
        return distance <= args.radius!;
      });
    }
    
    // Calculate counts (before pagination)
    const counts = {
      pending: allVoters.filter(v => v.status === "pending").length,
      done: allVoters.filter(v => v.status === "done").length,
      locked: allVoters.filter(v => v.status === "locked").length,
      revisit: allVoters.filter(v => v.status === "revisit").length,
      wrong_address: allVoters.filter(v => v.status === "wrong_address").length,
      total: allVoters.length,
    };
    
    // Calculate cluster counts
    const clusterCounts: Record<string, { total: number; pending: number }> = {};
    for (const voter of allVoters) {
      if (!clusterCounts[voter.areaCluster]) {
        clusterCounts[voter.areaCluster] = { total: 0, pending: 0 };
      }
      clusterCounts[voter.areaCluster].total++;
      if (voter.status === "pending") {
        clusterCounts[voter.areaCluster].pending++;
      }
    }
    
    // Calculate hidden vague count
    const hiddenVagueCount = allVoters.filter(
      v => v.addressQuality !== "actionable" && v.status === "pending"
    ).length;
    
    // Paginate
    const paginatedVoters = allVoters.slice(0, limit);
    
    // Add distance if location provided
    const items = paginatedVoters.map(voter => ({
      ...voter,
      distance: (args.lat && args.lng && voter.lat && voter.lng) 
        ? calculateDistance(args.lat, args.lng, voter.lat, voter.lng)
        : undefined,
    }));
    
    return {
      items,
      counts,
      clusterCounts,
      hiddenVagueCount,
      hasMore: allVoters.length > limit,
    };
  },
});

// Helper function to calculate distance between two points
function calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000; // Earth's radius in meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lng2 - lng1) * Math.PI) / 180;

  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

// Query to get a single voter by ID
export const getVoterById = query({
  args: { id: v.id("voters") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

// Query to get a voter by epic number
export const getVoterByEpicNumber = query({
  args: { epicNumber: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("voters")
      .withIndex("by_epicNumber", (q) => q.eq("epicNumber", args.epicNumber))
      .first();
  },
});

// Query to get a voter by row fingerprint
export const getVoterByFingerprint = query({
  args: { fingerprint: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("voters")
      .withIndex("by_rowFingerprint", (q) => q.eq("rowFingerprint", args.fingerprint))
      .first();
  },
});

// Mutation to update voter status and visited state
export const updateStatus = mutation({
  args: {
    voterId: v.id("voters"),
    status: v.optional(v.union(
      v.literal("pending"),
      v.literal("done"),
      v.literal("locked"),
      v.literal("revisit"),
      v.literal("wrong_address")
    )),
    visited: v.optional(v.boolean()),
    note: v.optional(v.string()),
    userId: v.optional(v.id("appUsers")),
  },
  handler: async (ctx, args) => {
    const voter = await ctx.db.get(args.voterId);
    if (!voter) {
      throw new Error("Voter not found");
    }
    
    const oldStatus = voter.status;
    const now = Date.now();
    
    const updates: Record<string, unknown> = {};
    
    // Update status if provided
    if (args.status) {
      updates.status = args.status;
      updates.statusUpdatedAt = now;
      updates.statusNote = args.note;
      updates.updatedByUserId = args.userId;
      
      // Log status change
      await ctx.db.insert("statusEvents", {
        voterId: args.voterId,
        fromStatus: oldStatus,
        toStatus: args.status,
        note: args.note,
        changedByUserId: args.userId,
        changedAt: now,
      });
    }
    
    // Update visited if provided
    if (args.visited !== undefined) {
      updates.visited = args.visited;
      updates.visitedAt = args.visited ? now : undefined;
      updates.visitedByUserId = args.visited ? args.userId : undefined;
    }
    
    updates.updatedAt = now;
    
    // Update voter
    await ctx.db.patch(args.voterId, updates);
    
    // Return updated voter with fresh counts
    const updatedVoter = await ctx.db.get(args.voterId);
    const allVoters = await ctx.db.query("voters").collect();
    const counts = {
      pending: allVoters.filter(v => v.status === "pending").length,
      done: allVoters.filter(v => v.status === "done").length,
      locked: allVoters.filter(v => v.status === "locked").length,
      revisit: allVoters.filter(v => v.status === "revisit").length,
      wrong_address: allVoters.filter(v => v.status === "wrong_address").length,
      total: allVoters.length,
    };
    
    return { voter: updatedVoter, counts };
  },
});

// Mutation to upsert a voter (used during import)
export const upsertVoter = mutation({
  args: {
    epicNumber: v.optional(v.string()),
    rowFingerprint: v.string(),
    name: v.string(),
    phoneNumber: v.optional(v.string()),
    age: v.string(),
    gender: v.string(),
    relativeName: v.optional(v.string()),
    relativeType: v.optional(v.string()),
    addressRaw: v.string(),
    displayAddress: v.string(),
    areaCluster: v.string(),
    addressQuality: v.union(
      v.literal("actionable"),
      v.literal("vague"),
      v.literal("missing")
    ),
    searchText: v.string(),
    assemblyConstituency: v.string(),
    district: v.string(),
    lat: v.optional(v.number()),
    lng: v.optional(v.number()),
    geocodeStatus: v.union(
      v.literal("resolved"),
      v.literal("approximate"),
      v.literal("failed")
    ),
    geocodeConfidence: v.number(),
    importBatchId: v.id("importBatches"),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    
    // Try to find existing voter by epic number first
    let existingVoter = null;
    if (args.epicNumber) {
      existingVoter = await ctx.db
        .query("voters")
        .withIndex("by_epicNumber", (q) => q.eq("epicNumber", args.epicNumber))
        .first();
    }
    
    // If not found by epic number, try fingerprint
    if (!existingVoter) {
      existingVoter = await ctx.db
        .query("voters")
        .withIndex("by_rowFingerprint", (q) => q.eq("rowFingerprint", args.rowFingerprint))
        .first();
    }
    
    if (existingVoter) {
      // Update existing voter, preserving status and visited
      await ctx.db.patch(existingVoter._id, {
        ...args,
        updatedAt: now,
        latestImportBatchId: args.importBatchId,
      });
      return { id: existingVoter._id, action: "updated" };
    } else {
      // Insert new voter
      const id = await ctx.db.insert("voters", {
        ...args,
        status: "pending",
        visited: false,
        statusUpdatedAt: undefined,
        updatedByUserId: undefined,
        statusNote: undefined,
        visitedAt: undefined,
        visitedByUserId: undefined,
        createdAt: now,
        updatedAt: now,
      });
      return { id, action: "inserted" };
    }
  },
});

// Mutation to batch upsert voters (for import efficiency)
export const batchUpsertVoters = mutation({
  args: {
    voters: v.array(v.object({
      epicNumber: v.optional(v.string()),
      rowFingerprint: v.string(),
      name: v.string(),
      phoneNumber: v.optional(v.string()),
      age: v.string(),
      gender: v.string(),
      relativeName: v.optional(v.string()),
      relativeType: v.optional(v.string()),
      addressRaw: v.string(),
      displayAddress: v.string(),
      areaCluster: v.string(),
      addressQuality: v.union(
        v.literal("actionable"),
        v.literal("vague"),
        v.literal("missing")
      ),
      searchText: v.string(),
      assemblyConstituency: v.string(),
      district: v.string(),
      lat: v.optional(v.number()),
      lng: v.optional(v.number()),
      geocodeStatus: v.union(
        v.literal("resolved"),
        v.literal("approximate"),
        v.literal("failed")
      ),
      geocodeConfidence: v.number(),
    })),
    importBatchId: v.id("importBatches"),
  },
  handler: async (ctx, args) => {
    const results = { inserted: 0, updated: 0, skipped: 0 };
    const now = Date.now();
    
    for (const voterData of args.voters) {
      // Try to find existing voter
      let existingVoter = null;
      if (voterData.epicNumber) {
        existingVoter = await ctx.db
          .query("voters")
          .withIndex("by_epicNumber", (q) => q.eq("epicNumber", voterData.epicNumber))
          .first();
      }
      
      if (!existingVoter) {
        existingVoter = await ctx.db
          .query("voters")
          .withIndex("by_rowFingerprint", (q) => q.eq("rowFingerprint", voterData.rowFingerprint))
          .first();
      }
      
      if (existingVoter) {
        // Update existing voter, preserve status and visited
        await ctx.db.patch(existingVoter._id, {
          ...voterData,
          updatedAt: now,
          latestImportBatchId: args.importBatchId,
        });
        results.updated++;
      } else {
        // Insert new voter
        await ctx.db.insert("voters", {
          ...voterData,
          status: "pending",
          visited: false,
          statusUpdatedAt: undefined,
          updatedByUserId: undefined,
          statusNote: undefined,
          visitedAt: undefined,
          visitedByUserId: undefined,
          latestImportBatchId: args.importBatchId,
          createdAt: now,
          updatedAt: now,
        });
        results.inserted++;
      }
    }
    
    return results;
  },
});
