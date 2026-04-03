import { NextResponse } from "next/server";
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

export const GET = requireAuth(async () => {
  try {
    const clusters = await convexClient.query(api.clusters.getClustersSummary, {});
    const response = NextResponse.json({ clusters });
    Object.entries(corsHeaders).forEach(([key, value]) => {
      response.headers.set(key, value);
    });
    return response;
  } catch (error) {
    console.error("Error fetching cluster summary:", error);
    const response = NextResponse.json(
      { error: "Failed to fetch cluster summary" },
      { status: 500 }
    );
    Object.entries(corsHeaders).forEach(([key, value]) => {
      response.headers.set(key, value);
    });
    return response;
  }
});
