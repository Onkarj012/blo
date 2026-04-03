import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

// Query to get cluster summaries for progress tracking
export const getClustersSummary = query({
  args: {},
  handler: async (ctx) => {
    const voters = await ctx.db.query("voters").collect();
    
    // Group by area cluster
    const clusterMap = new Map<string, {
      name: string;
      total: number;
      pending: number;
      done: number;
      locked: number;
      revisit: number;
      wrong_address: number;
      hasCoords: boolean;
      lat?: number;
      lng?: number;
    }>();
    
    for (const voter of voters) {
      if (!clusterMap.has(voter.areaCluster)) {
        clusterMap.set(voter.areaCluster, {
          name: voter.areaCluster,
          total: 0,
          pending: 0,
          done: 0,
          locked: 0,
          revisit: 0,
          wrong_address: 0,
          hasCoords: false,
        });
      }
      
      const cluster = clusterMap.get(voter.areaCluster)!;
      cluster.total++;
      cluster[voter.status]++;
      
      // Use first available coordinates
      if (!cluster.hasCoords && voter.lat && voter.lng) {
        cluster.hasCoords = true;
        cluster.lat = voter.lat;
        cluster.lng = voter.lng;
      }
    }
    
    return Array.from(clusterMap.values()).sort((a, b) => b.total - a.total);
  },
});

// Query to get map clusters (one per areaCluster with coordinates)
export const getMapClusters = query({
  args: {
    statusFilter: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const voters = await ctx.db.query("voters").collect();
    
    // Group by area cluster with coordinates
    const clusterMap = new Map<string, {
      name: string;
      lat: number;
      lng: number;
      total: number;
      pending: number;
      done: number;
      locked: number;
      revisit: number;
      wrong_address: number;
    }>();
    
    for (const voter of voters) {
      // Skip voters without coordinates
      if (!voter.lat || !voter.lng) continue;
      
      // Skip if filtered by status and doesn't match
      if (args.statusFilter && voter.status !== args.statusFilter) continue;
      
      if (!clusterMap.has(voter.areaCluster)) {
        clusterMap.set(voter.areaCluster, {
          name: voter.areaCluster,
          lat: voter.lat,
          lng: voter.lng,
          total: 0,
          pending: 0,
          done: 0,
          locked: 0,
          revisit: 0,
          wrong_address: 0,
        });
      }
      
      const cluster = clusterMap.get(voter.areaCluster)!;
      cluster.total++;
      cluster[voter.status]++;
    }
    
    return Array.from(clusterMap.values());
  },
});

// Query to get all unique area clusters
export const getAreaClusters = query({
  args: {},
  handler: async (ctx) => {
    const voters = await ctx.db.query("voters").collect();
    const clusters = new Set<string>();
    
    for (const voter of voters) {
      clusters.add(voter.areaCluster);
    }
    
    return Array.from(clusters).sort();
  },
});
