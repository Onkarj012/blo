import { NextResponse } from "next/server";
import { convexClient } from "@/lib/convex-server";
import { requireAdmin } from "@/lib/middleware";
import { api } from "@convex/_generated/api";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Cookie",
  "Access-Control-Allow-Credentials": "true",
};

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

export const GET = requireAdmin(async () => {
  try {
    // Get recent batches
    const batches = await convexClient.query(api.import.getBatches, { limit: 10 });
    
    // Get total voter count
    const voterResult = await convexClient.query(api.voters.getVoters, { limit: 1 });
    
    const response = NextResponse.json({
      batches: batches || [],
      stats: {
        total: voterResult?.counts?.total || 0,
        batches: batches?.length || 0,
      },
    });
    
    Object.entries(corsHeaders).forEach(([key, value]) => {
      response.headers.set(key, value);
    });
    return response;
  } catch (error) {
    console.error("Error fetching import batches:", error);
    const response = NextResponse.json(
      { error: "Failed to fetch import batches" },
      { status: 500 }
    );
    Object.entries(corsHeaders).forEach(([key, value]) => {
      response.headers.set(key, value);
    });
    return response;
  }
});
