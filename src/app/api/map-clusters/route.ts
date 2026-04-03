import { NextRequest, NextResponse } from "next/server";
import { convexClient } from "@/lib/convex-server";
import { requireAuth } from "@/lib/middleware";
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

export const GET = requireAuth(async (request: NextRequest) => {
  try {
    const { searchParams } = new URL(request.url);
    const statusFilter = searchParams.get("status") || undefined;
    
    const clusters = await convexClient.query(api.clusters.getMapClusters, {
      statusFilter,
    });
    
    const response = NextResponse.json({ clusters });
    Object.entries(corsHeaders).forEach(([key, value]) => {
      response.headers.set(key, value);
    });
    return response;
  } catch (error) {
    console.error("Error fetching map clusters:", error);
    const response = NextResponse.json(
      { error: "Failed to fetch map clusters" },
      { status: 500 }
    );
    Object.entries(corsHeaders).forEach(([key, value]) => {
      response.headers.set(key, value);
    });
    return response;
  }
});
