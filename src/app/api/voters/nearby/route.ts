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

type VoterStatus = "pending" | "done" | "locked" | "revisit" | "wrong_address";
const validStatuses: VoterStatus[] = ["pending", "done", "locked", "revisit", "wrong_address"];

export const GET = requireAuth(async (request: NextRequest) => {
  try {
    const { searchParams } = new URL(request.url);
    
    // Parse filters from query params
    const statusParam = searchParams.get("status") || "pending";
    const status = validStatuses.includes(statusParam as VoterStatus) 
      ? statusParam as VoterStatus 
      : "pending";
    
    const visitedParam = searchParams.get("visited");
    const visited = visitedParam && ["all", "visited", "unvisited"].includes(visitedParam) 
      ? visitedParam as "all" | "visited" | "unvisited"
      : undefined;
    const name = searchParams.get("name") || undefined;
    const phone = searchParams.get("phone") || undefined;
    const address = searchParams.get("address") || undefined;
    const gender = searchParams.get("gender") || undefined;
    const minAge = searchParams.get("minAge") ? parseInt(searchParams.get("minAge")!) : undefined;
    const maxAge = searchParams.get("maxAge") ? parseInt(searchParams.get("maxAge")!) : undefined;
    const areaCluster = searchParams.get("areaCluster") || undefined;
    const phoneOnly = searchParams.get("phoneOnly") === "true";
    const includeVague = searchParams.get("includeVague") === "true";
    const includeMissing = searchParams.get("includeMissing") === "true";
    const lat = searchParams.get("lat") ? parseFloat(searchParams.get("lat")!) : undefined;
    const lng = searchParams.get("lng") ? parseFloat(searchParams.get("lng")!) : undefined;
    const radius = searchParams.get("radius") ? parseInt(searchParams.get("radius")!) : undefined;
    const limit = parseInt(searchParams.get("limit") || "2000", 10);
    
    // Get voters from Convex - only pass defined params
    const result = await convexClient.query(api.voters.getVoters, {
      status,
      ...(visited ? { visited } : {}),
      ...(name ? { name } : {}),
      ...(phone ? { phone } : {}),
      ...(address ? { address } : {}),
      ...(gender ? { gender } : {}),
      ...(minAge !== undefined ? { minAge } : {}),
      ...(maxAge !== undefined ? { maxAge } : {}),
      ...(areaCluster ? { areaCluster } : {}),
      ...(phoneOnly ? { phoneOnly } : {}),
      ...(includeVague ? { includeVague } : {}),
      ...(includeMissing ? { includeMissing } : {}),
      ...(lat !== undefined ? { lat } : {}),
      ...(lng !== undefined ? { lng } : {}),
      ...(radius !== undefined ? { radius } : {}),
      ...(limit !== undefined ? { limit } : {}),
    });
    
    const response = NextResponse.json(result);
    Object.entries(corsHeaders).forEach(([key, value]) => {
      response.headers.set(key, value);
    });
    return response;
  } catch (error) {
    console.error("Error fetching voters:", error);
    const response = NextResponse.json(
      { error: "Failed to fetch voters" },
      { status: 500 }
    );
    Object.entries(corsHeaders).forEach(([key, value]) => {
      response.headers.set(key, value);
    });
    return response;
  }
});
